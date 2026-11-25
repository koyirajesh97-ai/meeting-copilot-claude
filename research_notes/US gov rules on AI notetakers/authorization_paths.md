# Authorization and security-approval paths for a meeting AI tool used by US federal agencies and contractors (as of 25 Nov 2026)

Scope: US federal only. Two product shapes compared throughout:
- (a) **Cloud SaaS meeting copilot**: audio/transcripts go to vendor cloud and/or LLM providers.
- (b) **Local-only desktop/phone app**: audio and text never leave the device; no vendor cloud holds federal data.

Method notes for the report writer:
- Research ran on 25 Nov 2026 via web search. Direct page fetches to fedramp.gov and techcommunity.microsoft.com were **blocked by this session's network policy**, so most facts below come from search-result extracts of the cited pages (primary pages where the URL is .gov/.mil/microsoft, otherwise law-firm or vendor pages, labeled). Treat quoted dates as "per search extract of that page" and spot-check the high-stakes ones before publication.
- A few baseline facts (NIST RMF, 32 CFR 2002) are cited to the primary URL from background knowledge and were **not re-fetched this session**; they are marked "[not re-verified 2026-11]".

---

## 1. FedRAMP: when required, 20x / Low / Moderate in 2025-2026, timelines and costs, and does an on-device app need it?

### Takeaway
FedRAMP applies to **cloud services that create, collect, process, store or maintain federal information on behalf of an agency**. A cloud meeting copilot is squarely in scope. A local-only app with no vendor cloud holding federal data is, on the plain scope text, **not** a FedRAMP product. It gets approved through the agency's own ATO/software-approval process instead. Any cloud component (licensing, telemetry, model downloads, crash reports, sync) can pull it back in if that component touches federal information. In 2026 FedRAMP itself changed: the 2026 Consolidated Rules (CR26) made "20x" generally available on 25 Jun 2026 and renamed impact levels into Classes A-D. New Rev5 submissions are cut off after 11 Jun 2027.

### Cited Findings
**Scope (what needs FedRAMP)**
- OMB M-24-15 (Jul 2024) scopes FedRAMP to "cloud computing products and services (such as IaaS, PaaS, and SaaS) that create, collect, process, store, or maintain Federal information on behalf of a Federal agency." — [FedRAMP: M-24-15 scope](https://www.fedramp.gov/docs/authority/m-24-15/scope/); [fedramp.gov 2026 scope page](https://fedramp.gov/2026/scope/); [OMB M-24-15 (archived)](https://bidenwhitehouse.archives.gov/omb/management/ofcio/m-24-15-modernizing-the-federal-risk-and-authorization-management-program-fedramp)
- M-24-15 lists exclusions, e.g. "information systems that are only used for a single agency's operations, hosted on cloud infrastructure or platform," subject to exceptions by the FedRAMP Director with OMB approval. — [FedRAMP: M-24-15 scope](https://www.fedramp.gov/docs/authority/m-24-15/scope/)
- FedRAMP guidance: ISV applications "developed and distributed for installation within a single tenant" of an IaaS/PaaS are out of scope, though the host service is in scope. FedRAMP "does not apply to every use of an internet-based service". The same service can be in or out of scope depending on use case, and **agencies are solely responsible** for determining whether their use falls in scope. — [FedRAMP: M-24-15 scope](https://www.fedramp.gov/docs/authority/m-24-15/scope/); [FedRAMP help: private cloud deployment](https://help.fedramp.gov/hc/en-us/articles/27703635042459-Should-my-agency-use-FedRAMP-to-authorize-private-cloud-deployment)
- FedRAMP RFC-0010 is draft interpretive technical assistance on scope exclusions and "MUST NOT be used as a checklist." — [FedRAMP RFC-0010](https://www.fedramp.gov/rfcs/0010)
- I found **no** FedRAMP statement that explicitly addresses installed desktop or mobile software with no vendor-hosted data. The scope text only covers cloud services. (gap; see Inferences)

**20x and CR26 (2025-2026 state)**
- 20x Phase 2 (Moderate pilot) ran 18 Nov 2025 to end of Mar 2026. The first cohort received pilot authorizations 6 Mar 2026, and 6 more CSPs were authorized by 27 Apr 2026. Phase 3 began Apr 2026. — [FedRAMP 20x Phase 2 recap](https://www.fedramp.gov/20x/phases/2/); [FedRAMP 20x timeline](https://fedramp.gov/20x/timeline/); [FedRAMP: initial Phase 2 participants (10 Dec 2025)](https://www.fedramp.gov/2025-12-10-announcing-the-initial-20x-phase-2-pilot-participants/)
- 25 Jun 2026: FedRAMP launched the **2026 Consolidated Rules (CR26)**. 20x "is no longer a pilot" and is now a widely available certification path. Class B and Class C 20x pipelines opened 31 Aug 2026. — [FedRAMP announcement 25 Jun 2026](https://www.fedramp.gov/2026-06-25-propelling-change-fedramp-launches-consolidated-rules-for-2026/); [FedScoop](https://fedscoop.com/fedramp-20x-widely-available-to-cloud-services-with-release-of-2026-consolidated-rules/)
- Under CR26, impact levels became certification classes: **Class B ~ former Low, Class C ~ Moderate, Class D ~ High**, plus a new time-limited entry tier, Class A. — [Secureframe roadmap (vendor blog)](https://secureframe.com/blog/fedramp-20x-roadmap.md). Schellman (assessor blog) cautions the classes are not a simple rebrand. — [Schellman](https://www.schellman.com/blog/federal-compliance/fedramp-consolidated-rules-for-rev-5-certiﬁcation-holders)
- Only the machine-readable CR26 is authoritative. The human-readable site is a convenience copy. — [Davis Wright Tremaine (law firm), Jul 2026](https://www.dwt.com/blogs/privacy--security-law-blog/2026/07/fedramp-2026-consolidated-rules)
- **Rev5 sunset:** FedRAMP help center says Rev5 submissions after **11 Jun 2027** will not be accepted. — [FedRAMP help](https://help.fedramp.gov/hc/en-us/articles/53961794314779-What-milestone-must-be-reached-by-11-June-2027-for-a-new-authorization-effort-to-proceed-under-Rev-5). Crowell says Rev5 authorization status is expected to end by end of 2028, and FedRAMP notice 0004 says the rules are valid through 31 Dec 2028. — [Crowell (law firm)](https://www.crowell.com/en/insights/client-alerts/time-for-a-change-fedramp-fundamentally-revamps-program-with-consolidated-rules-for-2026); [FedRAMP notice 0004](https://www.fedramp.gov/notices/0004). (These are likely two different milestones: new-submission cutoff vs. end of existing Rev5 status.)
- Earlier vendor roadmap items such as "CR26 mandatory 1 Jan 2027" come from a vendor blog only and are not confirmed on fedramp.gov. — [Secureframe](https://secureframe.com/blog/fedramp-20x-roadmap.md)
- Example 20x Moderate authorization: Secureframe says it achieved 20x Moderate in Jun 2026 (vendor self-report). — [Secureframe](https://secureframe.com/blog/announcing-fedramp-20x-moderate-authorization)

**Timelines and costs**
- FedRAMP's own RFC-0023 says legacy Rev4/Rev5 initial authorizations "might cost hundreds of thousands of dollars" (government side) and continuous monitoring tens of thousands. — [FedRAMP RFC-0023](https://www.fedramp.gov/rfcs/0023)
- Vendor estimates: 3PAO assessment roughly $100k-$250k for Low, up to $250k-$500k for High (Secureframe, citing Schellman). Rev5 typically takes 12-18+ months. 20x Phase One pilot participants reached Low in as little as 2-3 months, which is a pilot result, not a benchmark. — [Secureframe cost guide (vendor)](https://secureframe.com/hub/fedramp/costs.md); [Secureframe authorization guide (vendor)](https://secureframe.com/hub/fedramp/authorization.md)
- FedRAMP FY26 framing: "modern foundation in FY25 to deliver massive improvements in FY26." — [FedRAMP blog 30 Sep 2025](https://www.fedramp.gov/2025-09-30-fedramp-built-a-modern-foundation-in-fy25-to-deliver-massive-improvements-in-fy26/); Oct 2026 update "From foundation to implementation." — [FedRAMP blog 8 Oct 2026](https://www.fedramp.gov/2026-10-08-from-foundation-to-implementation/)

### Inferences
- **(a) Cloud copilot:** It needs FedRAMP for agency use with federal meeting content, realistically Class C (Moderate) because meeting audio/transcripts routinely contain CUI/PII. Starting now, the 20x Class C pipeline (open since 31 Aug 2026) is the path, since new Rev5 starts close 11 Jun 2027. Every downstream LLM/ASR provider used for "meeting" data_class also has to be FedRAMP-authorized at an equal or higher level. This maps to this repo's `config/providers.yaml` provider allow-list.
- **(b) Local-only app:** On the M-24-15 definition it is not a cloud service, so FedRAMP should not apply, provided the vendor never "creates, collects, processes, stores or maintains" federal information. Design implications: no transcript sync, no cloud crash dumps containing content, no content in telemetry. License checks and model/updates downloads should carry no federal data. Ship a "no-network mode" agencies can verify. The final in/out-of-scope call belongs to the agency, so the vendor should give them a written scope analysis.
- Phases 3-4 of this repo's roadmap (projects + sync, integrations) would turn variant (b) into variant (a) for those features. Consider making sync optional and separately packaged.

### Gaps
- No official FedRAMP text found that explicitly says "installed desktop/mobile software is out of scope." The inference rests on the cloud-service definition.
- Could not fetch fedramp.gov directly. Exact Class A-D definitions, the 20x cost model, and current authorized-count figures are unverified beyond search extracts.
- No authoritative all-in 2026 cost figure for a 20x Class C authorization was found.

---

## 2. Agency ATO and software approval lists for desktop software on government-furnished equipment (GFE); NIST RMF basics

### Takeaway
On-device software on GFE needs no FedRAMP. It still needs the agency's own approval: (1) admission to the agency's approved-software list / technical reference model (TRM), usually via a security review by the CISO/ISSO and sometimes an ATO or "ATO-by-inheritance" under the endpoint's existing system authorization (NIST SP 800-37 RMF, SP 800-53 controls). (2) For DoD, alignment with DISA STIGs and frequently a NIAP Common Criteria evaluation against the Protection Profile for Application Software, especially where encryption is involved. (3) An AI use-case review under each agency's AI policy. In Jan 2026 OMB dropped the mandatory secure-software attestation (M-22-18), so SBOM/attestation asks are now agency-by-agency.

### Cited Findings
- NIST SP 800-37 Rev. 2 defines the Risk Management Framework (Prepare, Categorize, Select, Implement, Assess, Authorize, Monitor). An Authorizing Official grants the ATO. SP 800-53 Rev. 5 is the control catalog, and SP 800-53B gives Low/Moderate/High baselines. — [NIST SP 800-37 Rev 2](https://csrc.nist.gov/pubs/sp/800/37/r2/final); [NIST SP 800-53 Rev 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) [not re-verified 2026-11]
- NIAP's **Protection Profile for Application Software v2.0** is dated 1 May 2025. A collaborative PP rebaselined from v2.0 is dated 16 Jun 2025, and it conforms to CC:2022 R1. — [PP App SW v2.0 (commoncriteria.github.io)](https://commoncriteria.github.io/pp/application/application.html); [cPP SD v2.0 draft](https://appswcpp.github.io/public-review/v2.0-draft/SD-Application-Software-v2.0-draft-review.pdf)
- NSA CSfC selections (3 Aug 2026) require TLS software apps to be NIAP-validated against PP Application Software v2.0 + TLS package v2.1. This applies to classified-use solutions, not ordinary software, but it shows the current baseline. — [NSA CSfC selections, TLS software apps, 2026-08-03](https://www.nsa.gov/Portals/75/documents/CSfC%20Selections%20Updates%202026/CSfC%20Selections%20for%20TLS%20Software%20Applications-2026-08-03.pdf)
- DoD has adopted NIAP app-vetting requirements for mobile apps used by DoD staff (vendor blog, undated, secondary). — [NowSecure (vendor)](https://www.nowsecure.com/?p=11520)
- **OMB M-26-05 (23 Jan 2026)** rescinded M-22-18 and M-23-16. Agencies no longer must collect the CISA Secure Software Development Attestation Common Form, but may still use it. They may adopt their own risk-based approach, which "could include requiring producers to provide" an SBOM. — [OMB M-26-05 (whitehouse.gov PDF)](https://www.whitehouse.gov/wp-content/uploads/2026/01/M-26-05-Adopting-a-Risk-based-Approach-to-Software-and-Hardware-Security.pdf); [Mayer Brown (law firm), Feb 2026](https://www.mayerbrown.com/en/insights/publications/2026/02/omb-rescinds-biden-era-software-security-memoranda); [Inside Government Contracts (Covington), Feb 2026](https://www.insidegovernmentcontracts.com/2026/02/omb-rescinds-the-common-form-secure-software-attestation-requirement/). **Superseded:** M-22-18 / M-23-16 attestation mandate.
- Agency AI policies cover AI used on agency systems, e.g. DOT AI policy dated 10 Jul 2026 covers "DOT personnel use of AI implemented on DOT information systems." — [DOT AI policy 2026-07-10](https://www.transportation.gov/sites/dot.gov/files/ai_policy_2026-07-10-508.docx). DOI OCIO generative AI policy memo dated Feb 2026. — [DOI OCIO GenAI policy](https://edit.doi.gov/sites/default/files/documents/2026-02/ocio-memouse-generative-ai-policy-final.pdf)
- NARA guidance treats some AI outputs (prompts, outputs, **meeting summaries**, chat histories) as potential federal records. Prompts saved in an agency system are "likely federal records." — [NARA FRA AI guidance](https://www.archives.gov/records-mgmt/policy/nara-fra-ai-guidance.pdf); [Just Security analysis](https://www.justsecurity.org/157670/federal-employees-ai-prompts-records-narrow-circumstances/)

### Inferences
- A local-only app is typically assessed as a component of the agency's existing endpoint system boundary, inheriting most 800-53 controls from the managed laptop (disk encryption, EDR, identity). The vendor's job is to show which controls the app itself affects: AC (access), AU (audit), SC-8/SC-13/SC-28 (encryption in transit/at rest, FIPS-validated crypto), SI (integrity/updates), CM-7 (least functionality, no network), and SR (supply chain).
- Records-management is a non-security approval gate. Because NARA treats meeting summaries as potential records, the app needs export/retention features that feed agency recordkeeping systems. This matters most for local-only storage, which otherwise strands records on a laptop.
- For DoD sales, expect requests for STIG-compliant install behavior and FIPS 140-3 validated crypto modules. NIAP evaluation is a differentiator and sometimes a requirement.

### Gaps
- Could not find a primary description of the DISA APL process or a rule saying when NIAP evaluation is mandatory for desktop apps on DoD networks (CNSSP-11 governs this; not verified this session).
- No government-wide "approved software list" exists. Each agency maintains its own TRM/allow-list, and none was retrievable to cite.

---

## 3. Contractors: DFARS 252.204-7012, NIST SP 800-171, CMMC 2.0 status, CUI rules for recording meetings

### Takeaway
For defense contractors, the binding baseline in late 2026 is still **DFARS 252.204-7012 + NIST SP 800-171 Rev 2**, not Rev 3, due to a DoD class deviation. CMMC Phase 1 (self-assessments) began 10 Nov 2025. Phase 2 (C3PAO Level 2), scheduled for 10 Nov 2026, was **suspended on 13 Jul 2026** pending a reform review. As of Nov 2026 no official restart had been found. A meeting recording or transcript containing CUI is itself CUI. Any device or service that stores or processes it must meet 800-171. A cloud tool must also meet FedRAMP Moderate (or equivalent) under 7012(b)(2)(ii)(D). A local app on a company laptop pulls that laptop into the contractor's CUI assessment scope.

### Cited Findings
- CMMC DFARS final rule published 10 Sep 2025, effective 10 Nov 2025 (Phase 1). Phase 2 scheduled 10 Nov 2026 would have required C3PAO Level 2 in applicable solicitations. — [Holland & Knight (law firm), Sep 2025](https://hklaw.com/en/insights/publications/2025/09/cmmc-goes-live-new-cybersecurity-requirements); [Schwabe (law firm)](https://www.schwabe.com/publication/dod-issues-final-rule-implementing-cmmc-requirements-in-dfars/)
- **13 Jul 2026:** the Department of War (DoD) immediately suspended CMMC Phase II and later milestones and launched a 60-day CMMC Reform Task Force review. Phase 1 self-assessments continue. Solicitations may include only Level 1 (Self) or Level 2 (Self), not Level 2 (C3PAO) or Level 3. No waivers are granted during review. The RFI deadline was 14 Aug 2026. — [WilmerHale, 20 Jul 2026](https://www.wilmerhale.com/en/insights/client-alerts/20260720-pentagon-suspends-cmmc-phase-2-requirements-and-launches-review-of-cybersecurity-certification-program); [Crowell](https://crowell.com/en/insights/client-alerts/department-of-war-immediately-suspends-cmmc-phase-ii-requirements-launches-60-day-reform-review); [Holland & Knight, 31 Jul 2026](https://hklaw.com/en/insights/publications/2026/07/dow-suspends-cmmc-phase-ii-requirements); [Jenner (cites memo dated 10 Jul 2026)](https://www.jenner.com/en/news-insights/client-alerts/department-of-war-suspends-cmmc-phase-iibut-compliance-obligations-remain-as-does-enforcement-risk); official program page [DoD CIO CMMC](https://dodcio.defense.gov/CMMC/About/)
- Task Force report was due to the DoW CIO ~11 Sep 2026 and was not public. Federal News Network (Oct 2026), working from an obtained summary, reported options including restarting Phase 2 for a narrower population over 90 days and extending POA&M windows to 270 days (requiring rulemaking). DoD declined to comment. — [Federal News Network, Oct 2026](https://federalnewsnetwork.com/defense-news/2026/10/rfi-offers-path-forward-for-dod-with-cmmc); [Inside Government Contracts, Sep 2026](https://www.insidegovernmentcontracts.com/2026/09/cmmc-reform-task-force-updates-september-2026/)
- DoD's May 2024 class deviation directs contractors to comply with NIST SP 800-171 **Rev 2**, not Rev 3 (released 14 May 2024), until rescinded. — [Mayer Brown, May 2024](https://www.mayerbrown.com/en/insights/publications/2024/05/us-dod-issues-class-deviation-delaying-dfars-implementation-of-upcoming-nist-sp-800-171-revision-3). A vendor blog says Revision 3 of DFARS Class Deviation 2026-O0025 issued 3 Sep 2026 keeps the Rev 2 baseline (single vendor source, not verified against acquisition.mil). — [Kiteworks (vendor)](https://www.kiteworks.com/cmmc-compliance/cmmc-dfars-revision-3-compliance/)
- During the pause, contractors must keep complying with DFARS 252.204-7012 and 800-171 Rev 2, and False Claims Act exposure for inaccurate SPRS scores remains. — [Morgan Lewis, Jul 2026](https://www.morganlewis.com/pubs/2026/07/department-of-war-suspends-cmmc-phase-ii-requirements-but-cybersecurity-obligations-remain); [Jenner](https://www.jenner.com/en/news-insights/client-alerts/department-of-war-suspends-cmmc-phase-iibut-compliance-obligations-remain-as-does-enforcement-risk)
- 32 CFR Part 2002 (CUI program) requires CUI on non-federal systems to be protected per NIST SP 800-171 and at no less than the Moderate confidentiality impact. — [eCFR 32 CFR 2002](https://www.ecfr.gov/current/title-32/subtitle-B/chapter-XX/part-2002) [not re-verified 2026-11]
- DFARS 252.204-7012(b)(2)(ii)(D) requires that external cloud services used to store/process/transmit covered defense information meet FedRAMP Moderate baseline "equivalent" requirements. — [DFARS 252.204-7012 (acquisition.gov)](https://www.acquisition.gov/dfars/252.204-7012-safeguarding-covered-defense-information-and-cyber-incident-reporting.) [not re-verified 2026-11]
- Practitioner/vendor content argues on-device transcription avoids sending CUI/ITAR discussions to third-party clouds. — [Basil AI (vendor blog), Apr 2026](https://basilai.app/articles/2026-04-23-ai-meeting-transcription-government-contractors-classified-discussions-itar-on-device-privacy.html)

### Inferences
- **Does a laptop app in a government meeting trigger these?** If the meeting discusses CUI/covered defense information, the recording/transcript is CUI. A **company laptop** running the app must already be inside the contractor's 800-171 / CMMC assessment boundary, and the app becomes an asset to document in the SSP. A **personal laptop** would generally be non-compliant to hold CUI at all. A **cloud** copilot additionally triggers the FedRAMP Moderate-equivalent test for the vendor and every sub-processor (LLM/ASR provider). Local-only sharply reduces the contractor's scope burden, which is its strongest selling point. It does not remove the need for the host endpoint to be compliant.
- Separately from cyber rules, the government meeting host's policy (consent/notice, see Section 2 NARA and Section 6 agency examples) governs whether a contractor may record at all. Recording a government meeting without the host's permission is a contract-relationship risk regardless of where the data goes.
- Export-controlled (ITAR/EAR) meetings add a further constraint: cloud processing by foreign-person-accessible providers is risky, which favors local-only.

### Gaps
- Whether DoD restarted CMMC Phase 2 between Oct and 25 Nov 2026 was not found. Treat the status as "suspended, reform pending."
- No primary federal guidance specifically on AI transcription of CUI meetings was found. The conclusions above are inferred from general CUI rules.
- The FAR CUI rule (proposed Jan 2025) status as of late 2026 was not researched.

---

## 4. Microsoft 365 GCC / GCC High / DoD Copilot: availability and "default approved" status (the competitor)

### Takeaway
Microsoft 365 Copilot went GA in GCC High in Dec 2025, and Microsoft says a DoD (IL5) offering exists. It sits inside Microsoft's existing FedRAMP High / DoD authorizations for M365 Government, so agencies already on M365 can approve it as an extension of a tenant they've authorized. That makes it the path of least resistance. Meeting-specific features are rolling out unevenly: Teams Copilot Chat in meetings and Intelligent Recap for GCC High/DoD were targeted for Oct 2026 with conflicting status.

### Cited Findings
- Microsoft 365 Copilot GA in GCC High announced 2 Dec 2025. Some Wave 2 features were expected H1 2026, and web grounding is off by default to keep data in the compliance boundary. — [Microsoft Public Sector blog, Dec 2025](https://techcommunity.microsoft.com/blog/publicsectorblog/microsoft-365-copilot-is-now-available-in-gcc-high/4473310); [Nextgov, Dec 2025](https://www.nextgov.com/acquisition/2025/12/microsoft-makes-copilot-available-secure-cloud-customers/409912/)
- Apr 2026: Copilot for US Government uses GPT-5.1 for Copilot Chat and adds Copilot Search and Copilot Connectors for GCC High. — [Microsoft Public Sector blog, Apr 2026](https://techcommunity.microsoft.com/t5/public-sector-blog/continuing-our-momentum-expanding-microsoft-365-copilot/ba-p/4506954)
- New capabilities and pricing for M365 Government were announced Dec 2025. — [Microsoft Public Sector blog](https://techcommunity.microsoft.com/t5/public-sector-blog/advancing-microsoft-365-government-new-capabilities-and-pricing/ba-p/4474648)
- A consultant source says Copilot in GCC High is covered under the M365 GCC High FedRAMP High authorization (secondary, unverified). — [Copilot Consulting (practitioner)](https://copilotconsulting.com/insights/microsoft-copilot-gcc-high-dod-sovereign-cloud-deployment-2026)
- Roadmap **RM569214**: Teams Copilot Chat for chats, channels, calls and meetings in GCC, GCC High and DoD, GA target Oct 2026. Microsoft docs (Aug 2026) said Copilot in Teams calls "isn't currently available" in GCC High/DoD. — [M365 roadmap mirror RM569214](https://mc.merill.net/message/RM569214)
- Roadmap **RM500242**: Teams Intelligent Recap for DoD, GA target Oct 2026. Status conflicts between "launched" and "in development" (18 Sep 2026 snapshot). — [RM500242](https://mc.merill.net/message/RM500242)
- Intelligent Recap needs Teams Premium or a Copilot license and requires transcription enabled. — [RM488298](https://mc.merill.net/message/RM488298)

### Inferences
- Agencies on M365 Government will treat Copilot/Teams Premium as the default approved option because it inherits an existing authorization and contract vehicle. A third-party tool has to justify itself on gaps: works in non-Teams meetings (in-person, Zoom for Government, Webex, phone), works offline/air-gapped, has no cloud data exposure, runs on cheaper per-seat pricing, or covers classification levels and features not yet in GCC High/DoD.
- The local-only model's strongest differentiator against Copilot is that **no data leaves the device**, including no Microsoft cloud processing. That matters for ITAR, attorney-client, personnel, and sensitive deliberative meetings, which agencies often exclude from cloud recording.

### Gaps
- Whether RM569214/RM500242 actually reached GA in Oct-Nov 2026 is unconfirmed.
- No agency policy was found that explicitly names Copilot as the mandatory/default meeting AI.

---

## 5. Section 508 accessibility for software sold to government

### Takeaway
Any ICT the government buys, including cloud and desktop/mobile apps, must meet the Revised Section 508 Standards: WCAG 2.0 Level A/AA, applied to non-web software via Chapter 5, plus Chapter 6 for support documentation. Vendors prove this with an Accessibility Conformance Report (ACR) built on the VPAT 2.x "508" edition, and agencies may test claims. Deployment model makes no difference here.

### Cited Findings
- Revised 508 standards require software and electronic content to conform to WCAG 2.0 Level A and AA. Software requirements are in Chapter 5, and non-web software uses the same WCAG 2.0 criteria. — [Section508.gov ACR/VPAT FAQ](https://www.section508.gov/sell/acr-vpat-faq/); [Section508.gov "Sell"](https://section508.gov/sell)
- Solicitations generally ask for an ACR for each commercial ICT item, and the government may test to validate conformance claims. — [Section508.gov: accessibility in procurement solicitation](https://www.section508.gov/buy/accessibility-in-procurement-solicitation-post-2/); [Section508.gov ART contract language template](https://assets.section508.gov/assets/files/ART%20Contract%20Language%20Template.pdf)
- VPAT 2.5 "508 edition" covers WCAG 2.0 plus Revised 508 Chapters 5 (software) and 6 (support docs). Vendors must state their testing method. — [HHS VPAT guidance](https://www.hhs.gov/web/section-508/contracting/technology-products/product-accessibility-template/index.html); [CMS VPAT information](https://www.cms.gov/data-research/cms-information-technology/section-508-cms/contractors-developers/voluntary-product-assessment-template)

### Inferences
- Meeting-copilot specifics: keyboard-only operation of record/stop and the recording indicator, screen-reader labels on the live transcript, text alternatives for any audio-only cue, color-contrast on the indicator, captions-quality transcript display, and accessible export formats. The Electron renderer can be tested with standard WCAG tooling. Native phone apps need platform accessibility testing.
- Commission the ACR from an independent tester for credibility. Agencies discount self-attested VPATs.

### Gaps
- No evidence found of a 2025-2026 refresh moving 508 to WCAG 2.1/2.2. Treat WCAG 2.0 AA as the legal floor. 2.1 AA is a common contractual ask.

---

## 6. What a local-only vendor should prepare, and examples of on-device AI tools approved

### Takeaway
No single federal "approval" exists for a local-only app. The vendor wins by making each agency's ATO/software-review and procurement easy. That means a documentation package proving no data egress, mapping the app to NIST 800-53 (agencies) and 800-171 (contractors), plus accessibility and supply-chain evidence. I found **no verifiable public record** of an agency formally approving a specific on-device AI notetaker. The examples found are vendor-marketed offline speech tools sold through government resellers, with no authorization claims.

### Cited Findings
- Agencies may now set their own risk-based software requirements, which may include an SBOM. The CISA Common Form attestation remains available but optional. — [OMB M-26-05](https://www.whitehouse.gov/wp-content/uploads/2026/01/M-26-05-Adopting-a-Risk-based-Approach-to-Software-and-Hardware-Security.pdf); [Wiley (law firm)](https://www.wiley.law/alert-OMB-Rescinds-Secure-Software-Development-Mandate-in-Favor-of-a-Risk-Based-Approach)
- Section 508 ACR is expected in solicitations. — [Section508.gov](https://www.section508.gov/buy/accessibility-in-procurement-solicitation-post-2/)
- NARA: meeting summaries and AI outputs may be federal records, so recordkeeping export is needed. — [NARA AI guidance](https://www.archives.gov/records-mgmt/policy/nara-fra-ai-guidance.pdf)
- Consent and notice norms: the Education Department allows AI recording/transcription of grant meetings only with prior written and verbal notice to all attendees, and ED staff may require it turned off. — [ED: Grants and AI](https://www.ed.gov/grants-and-programs/apply-grant/getting-started-discretionary-grant-applications/grants-and-artificial-intelligence-ai). In 2025, USAID staff reported Gemini recording meetings without consent. — [IT Brew, Feb 2025](https://itbrew.com/stories/2025/02/13/google-s-gemini-ai-recorded-meetings-without-consent-two-usaid-staffers-tell-it-brew)
- On-device/offline speech products marketed to public sector through Carahsoft (Moonshine / Useful Sensors). The listings make no authorization claims. — [Carahsoft: Useful Sensors](https://www.carahsoft.com/useful-sensors); [Carahsoft: Moonshine](https://www.carahsoft.com/moonshine/solutions)
- Speechmatics markets a laptop on-device ASR model (product claim, not an accreditation). — [Speechmatics on-device](https://speechmatics.com/speech-to-text/on-device)
- Prevail (cloud) claims ATOs from multiple large federal agencies and is pursuing FedRAMP. This is a cloud counterexample, self-reported. — [Prevail](https://prevail.ai/gov)

### Inferences: recommended vendor package for a local-only tool
1. **Data-flow diagram and network statement:** every outbound connection (updates, licensing, model download, telemetry) with exact hosts, the payload (proving no audio/text), and a verifiable offline/air-gap mode. Include packet-capture evidence.
2. **FedRAMP scope memo:** a one-page analysis against M-24-15 explaining why no vendor cloud service processes federal information. The agency makes the final call.
3. **NIST 800-53 Rev 5 control implementation summary** (app-relevant controls: AC, AU, CM, IA, SC-8/13/28, SI, SR) and a **NIST 800-171 Rev 2 mapping** for contractors (plus Rev 3 crosswalk for future-proofing).
4. **Crypto:** FIPS 140-3 validated modules for at-rest transcript encryption (OS-provided modules such as BitLocker/FileVault/Windows CNG/Apple corecrypto are the usual route).
5. **SBOM** (SPDX or CycloneDX), the optional CISA Secure Software Development Attestation, a vulnerability disclosure policy, and code-signing/update integrity description.
6. **AI-specific disclosure:** model cards for on-device ASR/LLM models, their provenance and license, and confirmation that no data is used for training.
7. **Section 508 ACR** (VPAT 2.5 508 edition), independently tested.
8. **Records and consent features:** visible recording indicator (already a repo rule), host-consent prompts, retention/deletion controls, and export to agency records systems.
9. **Completed standard questionnaires** (e.g., agency TRM intake, SIG/CAIQ-style) and STIG-friendly install docs. For DoD, consider a NIAP evaluation against PP Application Software v2.0 as a longer-term differentiator.
- This repo's current architecture (Section 1) is a **cloud** design: backend FastAPI + LiteLLM routing to providers, and Supabase. The local-only variant would need on-device ASR and LLM, so the backend/provider path becomes a cloud option that is off by default.

### Gaps
- No public, verifiable example found of a federal agency approving a specific on-device AI meeting/notetaker tool. Agency software allow-lists are generally not public.
- No federal template specific to "local-only AI apps" exists. The package above is synthesized from general requirements.

---

## Superseded / changed rules to flag (dates)
- **M-22-18 / M-23-16** secure software attestation mandate → rescinded by **M-26-05 (23 Jan 2026)**.
- **FedRAMP Low/Moderate/High + Rev5-only path** → **CR26 (25 Jun 2026)**: 20x generally available, Classes A-D, and new Rev5 submissions not accepted after **11 Jun 2027**.
- **CMMC Phase 2 date of 10 Nov 2026** → **suspended 13 Jul 2026**, and no restart confirmed as of 25 Nov 2026.
- **NIST SP 800-171 Rev 3 (May 2024)** exists, but DoD contracts still require **Rev 2** via class deviation.
- **M365 Copilot "not available in GCC High"** (pre-Dec 2025) → GA in GCC High Dec 2025. Teams meeting features for GCC High/DoD targeted Oct 2026.
