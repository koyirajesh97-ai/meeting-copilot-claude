#!/usr/bin/env node
// Generates TypeScript types and pydantic models from schema/events.json.
//
// Supports only the JSON Schema subset events.json uses, and fails loudly on anything else:
//   - top-level oneOf of $refs: the event union (each event has a const "type")
//   - $defs: string enums, objects, and allOf of objects/$refs to objects (merged)
//   - properties: $ref, const, string, integer, number, boolean, arrays,
//     and objects with additionalProperties (maps); minimum/maximum on numbers
//
// Usage: node scripts/gen-events.mjs  (run via `pnpm -w gen:events`)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const schemaPath = resolve(here, "../schema/events.json");
const tsOut = resolve(here, "../src/events.ts");
const pyOut = resolve(root, "services/backend/app/events.py");

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const defs = schema.$defs;

const PY_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
  "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return",
  "try", "while", "with", "yield",
]);

function fail(msg) {
  throw new Error(`gen-events: ${msg}`);
}

function refName(ref) {
  const m = /^#\/\$defs\/(\w+)$/.exec(ref);
  if (!m || !defs[m[1]]) fail(`unknown $ref ${ref}`);
  return m[1];
}

const isEnum = (s) => s.type === "string" && Array.isArray(s.enum);

/** Flatten an object def (or allOf of them) into {properties, required, description}. */
function flatten(name, s) {
  if (s.allOf) {
    const out = { properties: {}, required: [], description: s.description };
    for (const part of s.allOf) {
      const sub = part.$ref ? flatten(refName(part.$ref), defs[refName(part.$ref)]) : flatten(name, part);
      Object.assign(out.properties, sub.properties);
      out.required.push(...sub.required);
    }
    return out;
  }
  if (s.type !== "object" || !s.properties) fail(`${name}: expected an object with properties`);
  return { properties: s.properties, required: s.required ?? [], description: s.description };
}

// ---------- classify defs ----------
const eventNames = (schema.oneOf ?? []).map((r) => refName(r.$ref));
if (eventNames.length === 0) fail("top-level oneOf must list the events");
const enumNames = Object.keys(defs).filter((n) => isEnum(defs[n]));
const objectNames = Object.keys(defs).filter((n) => !isEnum(defs[n]) && !eventNames.includes(n));

const events = eventNames.map((name) => {
  const flat = flatten(name, defs[name]);
  const typeConst = flat.properties.type?.const;
  if (typeof typeConst !== "string") fail(`${name}: needs a const "type" property`);
  // Put "type" first, then the envelope, then the rest (insertion order already does this
  // except for "type", which lives in the event's own part).
  const { type, ...rest } = flat.properties;
  return { name, typeConst, ...flat, properties: { type, ...rest } };
});

// ---------- TypeScript ----------
function tsType(s, ctx) {
  if (s.$ref) return refName(s.$ref);
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (isEnum(s)) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  switch (s.type) {
    case "string": return "string";
    case "integer":
    case "number": return "number";
    case "boolean": return "boolean";
    case "array": return `${tsType(s.items, ctx)}[]`;
    case "object":
      if (s.additionalProperties && !s.properties) {
        return `Record<string, ${tsType(s.additionalProperties, ctx)}>`;
      }
  }
  fail(`${ctx}: unsupported schema ${JSON.stringify(s)}`);
}

const doc = (text, indent = "") => (text ? `${indent}/** ${text} */\n` : "");

function tsInterface(name, flat) {
  const lines = Object.entries(flat.properties).map(([prop, s]) => {
    const opt = flat.required.includes(prop) ? "" : "?";
    return `${doc(s.description, "  ")}  ${prop}${opt}: ${tsType(s, `${name}.${prop}`)};`;
  });
  return `${doc(flat.description)}export interface ${name} {\n${lines.join("\n")}\n}\n`;
}

let ts = "// Generated from schema/events.json by scripts/gen-events.mjs. Do not edit.\n";
ts += "// Run `pnpm -w gen:events` after changing the schema.\n\n";
for (const n of enumNames) ts += `${doc(defs[n].description)}export type ${n} = ${tsType(defs[n], n)};\n\n`;
for (const n of objectNames) ts += tsInterface(n, flatten(n, defs[n])) + "\n";
for (const e of events) ts += tsInterface(e.name, e) + "\n";
ts += `${doc(schema.description)}export type MeetingEvent =\n${events.map((e) => `  | ${e.name}`).join("\n")};\n\n`;
ts += 'export type MeetingEventType = MeetingEvent["type"];\n\n';
ts += `export const EVENT_TYPES = [\n${events.map((e) => `  ${JSON.stringify(e.typeConst)},`).join("\n")}\n] as const satisfies readonly MeetingEventType[];\n`;

// ---------- Python ----------
function pyType(s, ctx) {
  if (s.$ref) return refName(s.$ref);
  if (s.const !== undefined) return `Literal[${JSON.stringify(s.const)}]`;
  if (isEnum(s)) return `Literal[${s.enum.map((v) => JSON.stringify(v)).join(", ")}]`;
  switch (s.type) {
    case "string": return "str";
    case "integer": return "int";
    case "number": return "float";
    case "boolean": return "bool";
    case "array": return `list[${pyType(s.items, ctx)}]`;
    case "object":
      if (s.additionalProperties && !s.properties) {
        return `dict[str, ${pyType(s.additionalProperties, ctx)}]`;
      }
  }
  fail(`${ctx}: unsupported schema ${JSON.stringify(s)}`);
}

function pyField(prop, s, required, ctx) {
  const name = PY_KEYWORDS.has(prop) ? `${prop}_` : prop;
  let type = pyType(s, ctx);
  const args = [];
  if (s.const !== undefined) {
    // Default the discriminator so models can be built without repeating it.
    args.push(`default=${JSON.stringify(s.const)}`);
  } else if (!required) {
    type = `${type} | None`;
    args.push("default=None");
  }
  if (name !== prop) args.push(`alias=${JSON.stringify(prop)}`);
  if (s.minimum !== undefined) args.push(`ge=${s.minimum}`);
  if (s.maximum !== undefined) args.push(`le=${s.maximum}`);
  if (s.description) args.push(`description=${JSON.stringify(s.description)}`);
  return args.length ? `    ${name}: ${type} = Field(${args.join(", ")})` : `    ${name}: ${type}`;
}

function pyClass(name, flat) {
  const body = [];
  if (flat.description) body.push(`    """${flat.description}"""\n`);
  for (const [prop, s] of Object.entries(flat.properties)) {
    body.push(pyField(prop, s, flat.required.includes(prop), `${name}.${prop}`));
  }
  return `class ${name}(_Model):\n${body.join("\n")}\n`;
}

let py = '"""Generated from packages/shared/schema/events.json by gen-events.mjs. Do not edit.\n\n';
py += 'Run `pnpm -w gen:events` after changing the schema.\n"""\n\n';
py += "from typing import Annotated, Any, Literal\n\n";
py += "from pydantic import BaseModel, ConfigDict, Field, TypeAdapter\n\n\n";
py += "class _Model(BaseModel):\n";
py += "    model_config = ConfigDict(\n";
py += "        validate_by_name=True, validate_by_alias=True, serialize_by_alias=True\n";
py += "    )\n\n\n";
for (const n of enumNames) py += `${n} = ${pyType(defs[n], n)}\n`;
py += "\n\n";
for (const n of objectNames) py += pyClass(n, flatten(n, defs[n])) + "\n\n";
for (const e of events) py += pyClass(e.name, e) + "\n\n";
py += "MeetingEvent = Annotated[\n";
py += `    (\n${events.map((e, i) => `        ${i ? "| " : ""}${e.name}`).join("\n")}\n    ),\n`;
py += '    Field(discriminator="type"),\n]\n\n';
py += `EVENT_TYPES: tuple[str, ...] = (\n${events.map((e) => `    ${JSON.stringify(e.typeConst)},`).join("\n")}\n)\n\n`;
py += "_adapter: TypeAdapter[MeetingEvent] = TypeAdapter(MeetingEvent)\n\n\n";
py += "def parse_event(data: str | bytes | dict[str, Any]) -> MeetingEvent:\n";
py += '    """Parse one event from JSON text or a dict. Raises pydantic.ValidationError."""\n';
py += "    if isinstance(data, str | bytes):\n";
py += "        return _adapter.validate_json(data)\n";
py += "    return _adapter.validate_python(data)\n\n\n";
py += "def dump_event(event: MeetingEvent) -> dict[str, Any]:\n";
py += '    """Serialize an event to a JSON-ready dict, omitting unset optional fields."""\n';
py += '    return event.model_dump(mode="json", exclude_none=True)\n';

writeFileSync(tsOut, ts);
writeFileSync(pyOut, py);
console.log(`gen-events: wrote ${events.length} events to\n  ${tsOut}\n  ${pyOut}`);
