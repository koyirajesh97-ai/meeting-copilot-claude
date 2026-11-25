# US Federal Policy on AI Meeting Notetakers, Transcription and Meeting Assistants (as of Nov 2026)

> Method note (read first): Research done 2026-11-25. WebFetch could not reach archives.gov, nextgov.com or justsecurity.org from this session (DNS blocked), so no primary document was read in full. Every finding below comes from search-engine result summaries of the cited pages. Where a source is a vendor or marketing blog, it is labelled. Quotes are as they appeared in search excerpts, not checked against the full text. Before anyone relies on them, check the key primary sources: NARA AC 11.2026, OMB M-25-21, M-25-22 and M-26-04, and the Army CIO memo of 2025-09-02.

## 1. OMB AI memos and executive orders: what they require for agency use and acquisition of AI tools such as meeting transcription and summarization

### Takeaway
As of late 2026, the operative government-wide rules are still OMB M-25-21 (AI use and governance) and M-25-22 (AI acquisition), both from April 2025, plus M-26-04 (2025-12-11), which adds to M-25-22. I found no successor memo that rescinds them. None of these memos mentions meeting notetakers by name. A transcription or summary tool falls under their general rules: each agency's generative-AI policy, its annual use-case inventory, the "high-impact AI" minimum practices where they apply, and the contract terms of M-25-22. The Biden-era EO 14110 and memos M-24-10 and M-24-18 have been superseded.

### Cited Findings
- **EO 14110 (Oct 2023) was revoked on 2025-01-20**, as part of a broad rescission of Biden executive orders. — [Wiley alert](https://www.wiley.law/alert-President-Trump-Revokes-Biden-Administrations-AI-EO-What-To-Know); [Conference Board](https://conference-board.org/research/CED-Newsletters-Alerts/rescinding-ai-safety-executive-order)
- **EO 14179, "Removing Barriers to American Leadership in Artificial Intelligence" (signed 2025-01-23, Federal Register 2025-01-31)**, told agencies to review actions taken under EO 14110 and revise or rescind those that conflict with it. It also told the OMB Director to "revise OMB Memoranda M–24–10 and M–24–18 as necessary," within 60 days. — [Federal Register 2025-02172](https://www.federalregister.gov/documents/2025/01/31/2025-02172/removing-barriers-to-american-leadership-in-artificial-intelligence); [whitehouse.gov](https://www.whitehouse.gov/presidential-actions/2025/01/removing-barriers-to-american-leadership-in-artificial-intelligence/?cst)
- **M-25-21 ("Accelerating Federal Use of AI through Innovation, Governance, and Public Trust") and M-25-22 (AI acquisition), April 2025**, replaced M-24-10 and M-24-18 and carry out EO 14179. — [OMB M-25-21 PDF](https://www.whitehouse.gov/wp-content/uploads/2025/02/M-25-21-Accelerating-Federal-Use-of-AI-through-Innovation-Governance-and-Public-Trust.pdf); [Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/omb-issues-revised-policies-on-ai-use-and-procurement-by-federal-agencies); [Brookings, "new OMB memos signal continuity"](https://www.brookings.edu/articles/new-omb-memos-signal-continuity-in-federal-ai-policy/)
- **Still in force as of late Oct 2026:** a secondary source says that as of 2026-10-28, OMB's memoranda page still lists M-25-21 and no later memo rescinds it. The same source names 2026-09-22 as the milestone for reporting minimum practices for high-impact AI. — [Pyramid Systems blog](https://pyramidsystems.com/insights/blog/omb-m-25-21-federal-ai-governance-explained) (contractor blog; not checked against OMB)
- **M-25-22 is listed as "In Force."** — [regulations.ai](https://regulations.ai/regulations/RAI-US-NA-OMMDEXX-2025); [OECD.AI](https://oecd.ai/en/dashboards/policy-initiatives/omb-ai-acquisition-guidance-m-25-22)
- **M-26-04 (2025-12-11)** adds to M-25-22 with guidance on "unbiased AI principles" for LLMs that agencies buy. It is a companion memo and does not replace M-25-22. The IRS cites it in IRM 10.24.1, its AI governance policy. — [IRS IRM 10.24.1](https://www.irs.gov/node/156046)
- **M-25-21 deadlines:** each agency must write a generative-AI policy within 270 days and update its AI use-case inventory every year. — [KPMG summary](https://kpmg.com/kpmg-us/content/dam/kpmg/pdf/2025/omb-guidance.pdf)
- **M-25-21 risk tiers:** a single "high-impact AI" category replaces the earlier split between "rights-impacting" and "safety-impacting." The minimum practices include pre-deployment testing, AI impact assessments and ongoing monitoring. Agencies must document implementation within 365 days unless an exemption or waiver applies. — [Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/omb-issues-revised-policies-on-ai-use-and-procurement-by-federal-agencies); [Covington PDF](https://www.cov.com/-/media/files/corporate/publications/2025/04/omb-issues-first-trump-2-0-era-requirements.pdf)
- **M-25-22 scope:** it applies to contracts awarded or renewed 180 days after issuance, that is on or after about 2025-10-01. Required contract elements reportedly include a clear split of data and IP ownership between the government and the contractor. Contracts for high-impact use cases must also meet the minimum practices. — [Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/omb-issues-revised-policies-on-ai-use-and-procurement-by-federal-agencies); [Mintz](https://www.mintz.com/insights-center/viewpoints/54731/2025-04-11-omb-issues-new-guidance-federal-governments-use-ai-and)
- **Sources disagree on generative-AI obligations:** one law-firm analysis says the memos let agencies set their own practices and impose no specific rules for generative or biometric AI. Other summaries describe mandatory requirements. — [Perkins Coie](https://perkinscoie.com/insights/update/white-house-unveils-updated-ai-guidelines-federal-agencies) vs. [KPMG](https://kpmg.com/kpmg-us/content/dam/kpmg/pdf/2025/omb-guidance.pdf)
- A FedScoop item mentions a later administration action directing revision and rescission work under EO 14179, but the search excerpt gave no details. — [FedScoop](https://fedscoop.com/?p=82757)
- A Pillsbury alert describes a newer executive order on a "national policy framework for artificial intelligence." Its excerpt did not show any provision on agency use of notetakers. — [Pillsbury](https://www.pillsburylaw.com/en/news-and-insights/new-executive-order-national-policy-framework-artificial-intelligence.html)

### Inferences
- A meeting summarizer used internally for productivity is unlikely to count as "high-impact AI," because that tier targets decisions with legal, material or safety effects on people. The main controls on it are therefore the agency's generative-AI policy, its ATO/FedRAMP status and its records rules, not M-25-21's minimum practices. One exception: a summary used to make personnel, benefits or enforcement decisions could move the use case into the high-impact tier.
- For a vendor selling to agencies, M-25-22's contract terms on data and IP rights, together with the agency's ATO, are the main gatekeepers. Clauses on vendor model training with government data are likely negotiated under M-25-22's data-rights provisions. I could not confirm the exact wording (see Gaps).

### Gaps
- I could not read the text of M-25-21 or M-25-22 to quote their exact language on generative-AI policies, data rights, or bans on vendors training models with government data.
- I could not confirm the full content of M-26-04 or whether any OMB memo dated 2026 changes M-25-21 or M-25-22.
- I could not confirm whether the newer "national policy framework" executive order affects agency AI use.

## 2. Agency-specific policies that ban, restrict or approve AI notetakers (Otter, Fireflies, Zoom AI Companion, Teams Copilot in GCC/GCC High)

### Takeaway
Across several targeted searches I found no published federal agency policy that bans third-party AI notetakers such as Otter or Fireflies by name. Agencies instead control these tools through generic generative-AI rules: only tools with an ATO, and no sensitive data in unapproved tools. Meanwhile, government-authorized options exist. Zoom AI Companion is inside Zoom for Government's FedRAMP authorization, and Microsoft 365 Copilot is available in GCC, GCC High and DoD clouds, though it is disputed whether the Teams meeting-recap features are included. The Army has the most specific AI-records memo I found.

### Cited Findings
- **VA:** employees "cannot use the tool with VA sensitive data unless the tool has a VA ATO that allows its use with sensitive data." Approved tools include Microsoft Copilot Chat and "VA GPT," available to all employees and contractors. The VA AI use-case inventory lists summarizing meeting notes as a VA GPT use. Page dates were not shown in the excerpts. — [VA, Guidance for Generative AI Use at VA](https://department.va.gov/ai/guidance-for-generative-ai-use-at-va/); [VA AI Use Case Inventory](https://department.va.gov/ai/ai-use-case-inventory/)
- **GSA:** its AI compliance plan lists "summarize meeting notes" as a use case for its internal chatbot. It also describes the "USAi" shared service as a FedRAMP-authorized environment for generative AI. — [GSA AI strategies and compliance plan](https://www.gsa.gov/artificial-intelligence/resources/ai-strategies-and-compliance-plan)
- **Army (DoD), memo of 2025-09-02 by Army CIO Leonel Garciga:**
  - It brings AI tools under records management, privacy and FOIA obligations.
  - When responding to FOIA requests, personnel must disclose their use of AI prompts and content on official platforms for public business.
  - Application and system owners must capture and manage records generated through AI and low-code/no-code platforms.
  - It reportedly lists "meeting summaries" and "chat histories" (called "audit trails") among likely federal records.
  - Sources: [ExecutiveGov](https://www.executivegov.com/articles/army-garciga-application-owners-ai-records-mgmt); [search summary of Reason/ABA FOIA analysis](https://reason.com/wp-content/uploads/2026/09/Are-the-Goverments-AI-Conversations-Accessible.pdf). Coverage is secondary. The "meeting summaries/audit trails" wording may instead come from the NARA memo (see section 3), because sources mix the two up.
- **IRS:** IRM 10.24.1, "IRS Policy for Artificial Intelligence (AI) Governance," puts M-25-21, M-25-22 and M-26-04 into IRS practice. Its notetaker-specific content was not visible in the excerpts. — [IRS IRM 10.24.1](https://www.irs.gov/node/156046)
- **DOT:** published an AI Strategy Part III Compliance Plan under M-25-21 (Oct 2025). — [DOT PDF](https://www.transportation.gov/sites/dot.gov/files/2025-10/DOT_AI_Strategy_Part_III-Compliance_Plan.pdf)
- **Zoom AI Companion:** Zoom for Government added AI Companion and received FedRAMP JAB authorization at the Moderate level, announced 2024-09-16. This is a vendor press release. — [GlobeNewswire / Zoom](https://www.globenewswire.com/news-release/2024/09/16/2946937/0/en/Zoom-for-Government-Platform-Expands-With-Zoom-AI-Companion-Receives-FedRAMP-JAB-Authorization.html)
- **Microsoft 365 Copilot in GCC High:**
  - Microsoft announced availability in GCC High in December 2025, and Copilot is also in the GCC and DoD clouds. — [Nextgov, Dec 2025](https://www.nextgov.com/acquisition/2025/12/microsoft-makes-copilot-available-secure-cloud-customers/409912); [Microsoft Tech Community](https://techcommunity.microsoft.com/blog/publicsectorblog/microsoft-365-copilot-is-now-available-in-gcc-high/4473310)
  - Microsoft states that web grounding is off by default in GCC High and that the service adheres to FedRAMP High, DFARS, ITAR and CMMC. — [Microsoft Tech Community](https://techcommunity.microsoft.com/blog/publicsectorblog/microsoft-365-copilot-is-now-available-in-gcc-high/4473310)
  - **Teams meeting recap / meeting Copilot in GCC High is disputed:** a third-party page says meeting summaries are available, and its own feature table says they are not yet available. — [go-planet.com](https://go-planet.com/microsoft-365-copilot-gcc-high/) (consultant page; low reliability)
- **No federal ban found:** searches for DoD, DHS, State, DOJ, Treasury and HHS policies on AI notetakers or Otter/Fireflies returned only non-federal policies. Examples: Harvard banned AI meeting assistants in Feb 2025, UC Riverside allows only Zoom AI Companion, and ASAE and ASTC ban notetakers. — [Harvard Crimson 2025-02-12](https://www.thecrimson.com/article/2025/2/12/updated-ai-guidelines/); [UCR 2025-10-07](https://insideucr.ucr.edu/stories/2025/10/07/ucr-limits-ai-bots-comply-security-measures); [ASAE](https://www.asaecenter.org/about-us/policies/ai-notetaking-policies); [ASTC](https://www.astc.org/about/ai-notetaker-policy/)
- **State-level example of the approved-list pattern (not federal):** Maryland DoIT approves "Gemini Enterprise for Google Meet" and "Copilot for Microsoft Teams" and requires review for any other tool. — [Maryland DoIT governance card](https://doit.maryland.gov/policies/ai/Pages/AI-governance-card-call-recording-transcription-tools.aspx)
- **Litigation context driving buyer caution (private, not federal policy):**
  - In *In re Otter.AI Privacy Litigation*, No. 5:25-cv-06911 (N.D. Cal.), a ruling reported as 2026-08-13 let federal Wiretap Act, CIPA and BIPA claims proceed. It reportedly treats Otter as a plausible "third-party eavesdropper" under CIPA § 631.
  - Related suits include *Cruz v. Fireflies.AI* and *Chamberlain v. Granola*.
  - Coverage is mostly vendor blogs and has not been checked against the docket. — [tldv blog](https://tldv.io/blog/ai-meeting-recorder-lawsuits/); [basilai.app](https://basilai.app/articles/2026-10-15-otter-ai-third-party-eavesdropper-ruling-ai-notetaker-buyers.html)

### Inferences
- In practice, federal policy works as an allowlist: tools without an agency ATO, FedRAMP authorization or an approved-tools listing are excluded by default, without needing a named ban. That rules out consumer Otter and Fireflies for agency data. Notetakers inside platforms agencies already authorize (Zoom for Government AI Companion, M365 Copilot in GCC/GCC High) are the realistic approved path.
- Contractors who join agency meetings are likely bound by the hosting agency's rules and by their contract (FAR/DFARS, CUI clauses). A contractor-run bot joining an agency meeting is likely to be blocked or require approval. I found no explicit federal rule on this (see Gaps).

### Gaps
- I found no primary DHS, DoD-wide, State, DOJ, Treasury or HHS policy that names AI notetakers. Such policies may sit on internal intranets that are not public.
- I found no FedScoop, Nextgov or GovExec reporting on federal notetaker bans.
- I could not confirm whether Teams intelligent recap and Copilot in meetings are generally available in GCC High or DoD as of Nov 2026.
- I could not confirm the current FedRAMP status of Otter or Fireflies. The FedRAMP Marketplace was not checked.
- I found no explicit rule for contractors' own notetakers in agency meetings.

## 3. Federal records rules (NARA, Federal Records Act): are AI transcripts and summaries federal records, and what are the retention implications?

### Takeaway
NARA memo **AC 11.2026 (2026-08-21)**, "Guidance on Applying the Federal Records Act to Artificial Intelligence Materials," is the controlling guidance. AI use does not automatically create federal records. However, **AI-generated meeting summaries that are circulated to other employees or serve as the official meeting record are likely federal records.** Notes kept only for a person's own recollection are likely not records. Records may be destroyed only under a NARA-approved schedule, either the General Records Schedule (GRS) or an agency schedule. Agencies must build records requirements into their AI policies.

### Cited Findings
- **Memo:** NARA AC 11.2026, dated 2026-08-21 (one source says September 2026). — [NARA AC 11.2026](https://www.archives.gov/records-mgmt/memos/ac-11-2026); [NARA memo PDF](https://www.archives.gov/files/records-mgmt/policy/nara-fra-ai-guidance.pdf); [GovExec, Aug 2026](https://www.govexec.com/technology/2026/08/national-archives-says-agencies-ai-use-does-not-automatically-create-federal-records/415714/); [Nextgov, Aug 2026](https://www.nextgov.com/artificial-intelligence/2026/08/national-archives-says-agencies-ai-use-does-not-automatically-create-federal-records/415711/)
- **Core rule:** using AI platforms does not "in and of itself" create federal records. AI inputs and outputs can still qualify, depending on "the circumstances surrounding the creation, maintenance, and use of the materials," such as whether the agency relies on them in decisions. — [Nextgov](https://www.nextgov.com/artificial-intelligence/2026/08/national-archives-says-agencies-ai-use-does-not-automatically-create-federal-records/415711/); [qflow blog](https://blog.qflow.com/en/nara-says-ai-use-doesn-t-automatically-create-federal-records-here-s-what-it-actually-shifts)
- **Meeting summaries:** AI-generated meeting summaries circulated to other employees, or serving as the official meeting record, are likely federal records. Notes kept only for an individual's own recollection, and not circulated or used as the official record, are likely not. — [GovExec](https://www.govexec.com/technology/2026/08/national-archives-says-agencies-ai-use-does-not-automatically-create-federal-records/415714/); [NARA memo PDF](https://www.archives.gov/files/records-mgmt/policy/nara-fra-ai-guidance.pdf)
- **Audit trails:** "mere retention of the audit trail within the AI system does not establish that the audit trail is a federal record." — [search summary of NARA memo / qflow](https://blog.qflow.com/en/nara-says-ai-use-doesn-t-automatically-create-federal-records-here-s-what-it-actually-shifts)
- **Readings conflict:**
  - Just Security / Vanderbilt Policy Accelerator read the memo as listing prompts and outputs, meeting summaries and chat histories ("audit trails") as likely records only "in narrow circumstances." — [Just Security](https://www.justsecurity.org/157670/federal-employees-ai-prompts-records-narrow-circumstances/); [Vanderbilt Substack](https://vanderbiltpolicyaccelerator.substack.com/p/federal-employees-ai-prompts-are)
  - Other commentary says the guidance exempts most chatbot prompts and outputs.
  - Uses of commercial programs such as Gemini and ChatGPT are described as likely not federal records, though each agency decides.
- **Disposition:** AI materials that meet the definition of a federal record need a NARA-approved schedule, GRS or agency-specific, before the agency may dispose of them. — [NARA memo PDF (via search summary)](https://www.archives.gov/files/records-mgmt/policy/nara-fra-ai-guidance.pdf)
- **Agency duty:** agencies should build federal records-management requirements into their internal AI policies. — [NARA memo PDF (via search summary)](https://www.archives.gov/files/records-mgmt/policy/nara-fra-ai-guidance.pdf)
- **Army practice:** the Army's 2025-09-02 CIO memo requires system owners to capture and manage AI-generated records. — [ExecutiveGov](https://www.executivegov.com/articles/army-garciga-application-owners-ai-records-mgmt)

### Inferences
- **For a meeting-copilot product:** a shared summary or transcript posted to a team channel, emailed to attendees or filed as minutes is likely a federal record. The product would then need to support export to the agency's recordkeeping system, holds and retention by schedule, and no automatic deletion by the vendor that conflicts with the schedule.
- A purely personal, unshared transcript may fall outside the records rules. Its status can change once it is shared, and a product cannot easily enforce that line.
- Raw audio and verbatim transcripts are not specifically covered in the excerpts I saw. By the same logic, they are likely records when used as the official record of the meeting.

### Gaps
- I could not read the memo text to quote its examples exactly, or to see whether it addresses raw recordings or verbatim transcripts separately from summaries.
- I could not confirm which GRS items apply to AI meeting summaries, for example GRS 5.1 transitory records, GRS 4.2 or the GRS 6.x series.
- Sources disagree on the issue date: 2026-08-21 vs. September 2026.

## 4. Privacy Act, PII/CUI handling and FOIA implications of recordings and transcripts

### Takeaway
No court has ruled on FOIA access to government AI conversations, but the standard *DOJ v. Tax Analysts* test (agency created or obtained the material and controls it) is expected to apply. Transcripts and summaries that are agency records are therefore FOIA-able, subject to the usual exemptions such as Exemption 5 (deliberative process) and the privacy exemptions. The Army explicitly requires AI content to be kept and disclosed for FOIA. I found no source tying AI meeting transcripts to Privacy Act system-of-records (SORN) requirements. Under the general rule, the Act applies only if the records are retrieved by personal identifier. Sensitive data, including CUI, may go only into tools with an agency ATO (VA example).

### Cited Findings
- **No court ruling yet:** no court has published a decision applying FOIA or a state public-records act to officials' conversations with AI chatbots. Material must be created or obtained by the agency and under its control when requested, the *Tax Analysts* test. FOIA exemptions for deliberative, attorney-client, work-product and personal-privacy material still apply. — [Reason Foundation PDF, Sept 2026](https://reason.com/wp-content/uploads/2026/09/Are-the-Goverments-AI-Conversations-Accessible.pdf); [ABA Communications Lawyer, Fall 2026](https://www.americanbar.org/groups/communications_law/resources/magazine/2026-fall/ai-accessible-under-public-records-laws-foia/)
- **Army FOIA rule:** the 2025-09-02 Army CIO memo requires personnel to disclose AI prompts and content used on official platforms when responding to FOIA. It reportedly requires these to be kept "to support timely FOIA responses." — [ExecutiveGov](https://www.executivegov.com/articles/army-garciga-application-owners-ai-records-mgmt)
- **Privacy Act framework:** the Act applies to "any record which is contained in a system of records," and agencies may exempt systems from some provisions. — [CRS R46238 (FOIA legal overview)](https://www.congress.gov/crs-product/R46238)
- **ChatGPT records and FOIA commentary:** [National Law Review](https://natlawreview.com/article/are-chatgpt-records-subject-foia); [FOIA Advisor, 2026-08-17](https://www.foiaadvisor.com/foia-blog/2026/8/17/2ygnei5cqsk2i16zudwjkh2ot8a73c)
- **Sensitive data:** VA bars use of VA sensitive data in AI tools that lack a VA ATO allowing sensitive data. — [VA guidance](https://department.va.gov/ai/guidance-for-generative-ai-use-at-va/)
- **Contractor CUI/ITAR (vendor opinion):** a vendor argues that CUI and ITAR discussions require on-device processing. This is a commercial claim, not policy. — [basilai.app](https://basilai.app/articles/2026-04-23-ai-meeting-transcription-government-contractors-classified-discussions-itar-on-device-privacy.html)
- **Discoverability:** transcripts are generally discoverable in litigation and investigations, per law-firm commentary. — [robmelton.com](https://www.robmelton.com/ai-notetakers-and-recording-tools-in-the-enterprise-wiretapping-consent-privilege-and-retention/)

### Inferences
- A notetaker that indexes transcripts by speaker name or identity, for example voiceprints or a per-person history, could create a Privacy Act "system of records." That would require a SORN and a Privacy Impact Assessment (PIA) under the E-Government Act. This follows from the general rules and is not stated in any notetaker-specific guidance I found.
- Speaker diarization and voiceprints raise biometric-privacy concerns. The BIPA claims against Otter and Fireflies show the litigation risk, although BIPA is state law.
- Meetings that include CUI would put the tool under the agency's CUI program (32 CFR Part 2002) and, for contractors, DFARS 252.204-7012 / CMMC. I did not find sources stating this specifically for notetakers.

### Gaps
- No source on SORNs or PIAs specific to AI meeting transcription.
- No CUI-program guidance that addresses notetakers by name.
- Not verified: whether agency e-discovery or FOIA guidance treats raw audio differently from transcripts.

## 5. Rules on recording meetings at all in federal settings (consent, notice)

### Takeaway
Federal wiretap law (ECPA, 18 U.S.C. § 2511(2)(d)) is one-party consent, but about 12 states require all-party consent. A notetaker bot that is not itself a party has drawn claims under both federal and state law (the Otter litigation). I found no government-wide federal rule that requires notice before recording internal agency meetings. Agency and union rules apply locally: federal-sector labor matters fall under 5 U.S.C. Chapter 71 and the FLRA, and FLRA has meeting guidance. Public advisory-committee meetings under FACA have separate rules on minutes and openness, which were not researched here.

### Cited Findings
- **ECPA one-party consent:** recording is allowed when one party to the conversation consents. — [Venable, 2026-02-10](https://www.venable.com/insights/publications/2026/02/workplace-recordings-in-the-digital-age-balancing); [Seyfarth](https://www.seyfarth.com/news-insights/workplace-recordings-and-eavesdropping-limiting-criminal-and-legal-liabilities.html)
- **State all-party consent:** 12 states, including CA, FL, IL, MA and PA, require all-party consent. — [robmelton.com](https://www.robmelton.com/ai-notetakers-and-recording-tools-in-the-enterprise-wiretapping-consent-privilege-and-retention/) (secondary)
- **Otter "third-party eavesdropper":** the theory is that a vendor bot is not a party, so one participant's consent may not cover the vendor. The ruling was reported as 2026-08-13 and has not been checked against the docket. — [basilai.app](https://basilai.app/articles/2026-10-15-otter-ai-third-party-eavesdropper-ruling-ai-notetaker-buyers.html)
- **Federal-sector labor framework:** 5 U.S.C. Chapter 71, administered by the FLRA. FLRA OGC has issued meetings guidance (2015-08-28) on formal discussions and union rights at meetings. In an FLRA ULP case, a VA employee recorded a meeting and gave the recording to the union. The excerpt did not show how the case was resolved. — [FLRA OGC Meetings Guidance PDF](https://www.flra.gov/system/files/webfm/OGC/Guidances/MEETINGS%20GUIDANCE%208-28-15%20final_1.pdf); [FLRA decision (SATCO / Edwards AFB)](https://www.flra.gov/decisions/alj-decisions/sport-air-traffic-controllers-organization-satco-and-air-force-flight-test)
- **Private-sector analogy:** employers in one-party-consent states may ban recording by policy and discipline violations. Whether this carries over to federal employers is unclear. — [Fisher Phillips](https://www.fisherphillips.com/print/v2/content/13760/wired-for-sound-the-ins-and-outs-of-workplace-recordings.pdf)

### Inferences
- **Product design:** the safest defaults match the project's "visible recording indicator" rule. Announce the recording to all participants, show a visible indicator, and let the host control or approve the recording. That meets all-party-consent expectations and reduces the third-party-eavesdropper risk.
- Recording a meeting where the union has formal-discussion rights may raise Chapter 71 bargaining or ULP issues. Agencies may have negotiated recording rules in collective bargaining agreements.

### Gaps
- No government-wide OPM or OMB rule found on notice or consent for recording internal federal meetings.
- Not verified: the text of 18 U.S.C. § 2511 or FLRA precedent on bans of AI recording.
- FACA and Sunshine Act rules on recording or transcribing public meetings were not researched.
