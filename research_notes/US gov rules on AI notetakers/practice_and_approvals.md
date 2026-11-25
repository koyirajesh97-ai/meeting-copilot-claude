# US Government Practice on AI Notetakers: Bans, Approved Tools, and the Approval Playbook (as of Nov 2026)

> Method note: This session's network policy blocked direct page fetches (WebFetch failed with DNS errors for bellevuewa.gov, ai.georgia.gov and bsquarebulletin.com). Every finding below comes from web-search result summaries and snippets, not full-page reads. Treat quotes as close paraphrases and check each source before publishing. Many 2026 results came from vendor blogs (basilai.app, meetily.ai, summarizemeeting.com, coommit.com and others); these are labeled **[vendor marketing]** and should not be used as primary evidence.

## 1. Documented bans and blocks of AI notetaker bots in government, and why

### Takeaway
I found three concrete US government restrictions, all state or local: Georgia's state guidance prohibits AI note-taking tools in state Teams meetings and on other conferencing platforms; Indiana's state records agency advises against admitting AI notetakers to remote government meetings; and the City of Bellevue, WA disables AI notetakers in city-hosted non-public Teams meetings unless an exception is approved. I found no published federal agency-wide ban on Otter, Fireflies or Read.ai, and no news-verified incident of a bot leaking a government closed session. The drivers are records law, open-meetings law, consent and wiretap risk, and the Otter.ai litigation.

### Cited Findings
- **Georgia (state):** Georgia's state AI guidance says use of AI note-taking tools is prohibited in State of Georgia Microsoft Teams meetings or any other conferencing platforms. The guidance is undated in the snippet; verify the current version. — [Georgia AI: Guidance for State Organizations](https://ai.georgia.gov/guidance/guidance-state-organizations)
- **Georgia (state):** Georgia Technology Authority's AI tool-use page requires prior GTA authorization for any generative AI tool meant for regular organizational use, explicitly including AI-driven transcription, summarization and note-taking. That makes GTA approval the formal path for a vendor. — [GTA: AI Tool Use](https://gta.georgia.gov/policies-and-programs/artificial-intelligence/ai-tool-use)
- **Indiana (state):** The Indiana Archives & Records Administration has advised against admitting AI notetakers as participants in remote government meetings. The advice came alongside a new Indiana law requiring live-streamed government meetings. The search snippet did not give a full rationale or an exact date (the article appears to be from 2025 or 2026). — [B Square Bulletin](https://bsquarebulletin.com/live-streamed-govt-meetings-now-required-by-indiana-law-state-records-agency-advises-banning-ai-notetakers/)
- **City of Bellevue, WA (local):** City IT has turned off most AI notetakers in city-hosted Teams meetings that are not open to the public, and it adds a notice to those meeting invites. City policy prohibits AI bots and automated virtual assistants in non-public Teams meetings unless an exception has been approved. The search tool described the page as about 14 months old, so roughly late 2025. — [Bellevue: AI Notetakers Guidance](https://bellevuewa.gov/ai-notetakers-guidance)
- **Bellevue, public meetings:** Staff are told not to stop members of the public from using AI notetakers at public meetings, because the public has broad rights to record public meetings. Staff may only ask that a notetaker be turned off. — [Bellevue: AI Notetakers Guidance](https://bellevuewa.gov/ai-notetakers-guidance)
- **Aurora, CO (counter-example):** A city committee was told that no policy restricts AI note-taking and that staff can use the tools until council acts. No vote was taken; members suggested bringing a formal policy back if concerns arose. The source is an AI-generated civic news summary and the date was not clear in the snippet. — [Citizen Portal](https://citizenportal.ai/articles/8000515/colorado/douglas-county/aurora-city/committee-told-no-policy-exists-on-ai-notetaking-staff-can-use-tools-until-council-acts)
- **Local-government guidance:** UNC School of Government publishes "14 recommendations" for local-government AI use policies, which include AI tools in meetings. I saw only the snippet. — [UNC SOG Coates' Canons](https://www.sog.unc.edu/blogs/coates-canons/developing-and-updating-ai-use-policies-14-recommendations-local-governments-0)
- **Bot-joins-uninvited pattern (non-government):** Carleton College describes Otter joining a Google Meet that nobody had intentionally invited it to. The only sign was a transcript emailed afterward. — [Carleton College AI blog](https://www.carleton.edu/ai/blog/an-uninvited-guest-what-you-should-know-about-otter-ais-notetaker/)
- **Board-meeting incident (unverified, first-person):** A board member describes an Otter notetaker, invited by the board secretary, that recorded and distributed a whole meeting, including a confidential personnel discussion. The resulting minutes contained a complete transcript. This is a blog post, not verified news. — [Greater Governance](https://greatergovernance.com/p/ai-in-the-boardroom-what-every-director)
- **Litigation driving restrictions:** *In re Otter.AI Privacy Litigation* (N.D. Cal.) alleges the bot recorded and transcribed non-users without consent and used recordings to train models. The court let the core claims proceed, reasoning that Otter is plausibly a third-party eavesdropper because it uses recordings for its own commercial benefit. The ruling was at the pleading stage, so it is not a finding of liability. — [National Law Review](https://natlawreview.com/article/when-ai-takes-notes-court-allows-privacy-claims-against-otterai-proceed); [Sheppard Mullin](https://www.sheppard.com/insights/blogs/when-ai-takes-notes-court-allows-privacy-claims-against-otterai-to-proceed); [NLR: third-party eavesdropper](https://natlawreview.com/article/invited-participant-or-third-party-eavesdropper-court-holds-otterai-third-party)
- **Date of the Otter ruling:** One search summary dates the denial of dismissal to August 13, 2026. That date comes from a vendor-blog-heavy result set, so check it on the docket. — [Scribbl (vendor)](https://scribbl.co/post/otter-ai-lawsuit)
- **Fireflies litigation:** A parallel case over auto-joining meetings has been filed: *Cruz v. Fireflies.AI Corp.* — [NLR: new wave of litigation](https://natlawreview.com/article/take-note-new-wave-privacy-litigation-targets-ai-notetaker-otterai)
- **Federal/DoD:** I found no memo banning AI notetakers specifically. A Washington Technology op-ed (Nov 2026) discusses a WIRED report on unauthorized AI use involving a DoD contractor (Accenture disputes the allegations). The op-ed argues that the standard response, "a memo reminding everyone that unapproved AI tools are prohibited," rarely works. — [Washington Technology](https://www.washingtontechnology.com/opinion/2026/11/pentagon-wont-stop-rogue-ai-another-memo/417129/)
- **Analogous private-sector ban (government-adjacent insurer):** BlueCross BlueShield of South Carolina announced "AI note-taking is prohibited effective immediately" in its agent training sessions (2026), naming tools like Otter.ai and Fireflies. — [SC Blues notice](https://www.southcarolinablues.com/en/home/agents/individuals-and-small-groups/news-and-events/2026/ai-note-taking-is-prohibited-effective-immediately.html)
- **Non-US comparator:** Derbyshire County Council (UK) tells staff they must not invite or permit external AI notetakers such as Otter and Fireflies in council-hosted meetings. — [Derbyshire staff guidance PDF](https://staff.derbyshire.gov.uk/site-elements/documents/information-security/meeting-etiquette-for-ai-notetakers.pdf)

### Inferences
- Government practice is converging on a two-tier rule: block third-party bots in internal and non-public meetings, but accept that the public may record public meetings. A tool that never joins as a bot, and stays under the host organization's control, sidesteps the main objection.
- Records retention is a distinct driver in government. A third-party bot creates a public record held outside the agency, which is a problem for open-records law. The Indiana advice comes from the *records* agency, not IT.
- Search-surfaced vendor blogs often cite a Microsoft Teams default change that stops third-party bots from auto-joining. I could not confirm it from Microsoft, so it is not included as a finding.

### Gaps
- No full-text read of the Georgia, Indiana or Bellevue documents (fetch blocked), so I have no exact effective dates or rationale text.
- I found no federal civilian agency (GSA, VA, HHS and others) public policy naming AI notetaker bots, and no news-verified government data-leak incident from a notetaker bot.
- I did not search other states (Texas DIR, WaTech, California, New York ITS, Utah) individually.

## 2. Meeting AI tools approved or widely used in government, and their authorization status

### Takeaway
The safe, approved route in government is AI built into the already-authorized collaboration platform. Zoom AI Companion has FedRAMP authorization (JAB Moderate, Sept 2024) within Zoom for Government. Microsoft 365 Copilot reached GCC High at the end of 2025, but Teams meeting recap in GCC High and DoD was still on the roadmap in mid/late 2026. Webex for Government's AI meeting summaries are not confirmed as covered by its FedRAMP authorization. I found no evidence that Otter, Fireflies or Read.ai hold FedRAMP authorization.

### Cited Findings
- **Zoom:** The FedRAMP Joint Authorization Board authorized Zoom AI Companion as JAB Moderate within the Zoom for Government platform. The authorized products also include Zoom Meetings, Phone and Team Chat. The press release is from Sept 2024, so it is older and current scope should be checked on the FedRAMP Marketplace. — [Zoom newsroom](https://news.zoom.com/zoom-for-government-platform-expands-with-zoom-ai-companion-receives-fedramp-jab-authorization/); [UC Today](https://www.uctoday.com/collaboration/zooms-ai-companion-receives-fedramp-ok-for-government-use/)
- **Microsoft GCC High:** Microsoft announced that Microsoft 365 Copilot is available in GCC High, with web grounding off by default. Third-party sources date general availability to Dec 2025. — [Microsoft Tech Community](https://techcommunity.microsoft.com/blog/publicsectorblog/microsoft-365-copilot-is-now-available-in-gcc-high/4473310)
- **Microsoft government roadmap:** Microsoft's "What's Next in Microsoft 365 Copilot for Government" post lists a unified Copilot experience across Teams chats, channels, calls and meetings as *planned* for GCC High. It also lists intelligent meeting recap for DoD as on the roadmap. — [Microsoft Tech Community](https://techcommunity.microsoft.com/blog/publicsectorblog/whats-next-in-microsoft-365-copilot-for-government/4555457)
- **Copilot in Teams meetings, GCC High:** A secondary guide citing Microsoft says Copilot in Teams meetings isn't currently available in GCC High. Sources conflict on whether DoD has general availability or a controlled preview. — [babybots.ai guide (secondary)](https://www.babybots.ai/guides/copilot-ai-agents-gcc-high-dod-2026); [copilotconsulting (secondary)](https://www.copilotconsulting.com/insights/microsoft-copilot-gcc-high-dod-sovereign-cloud-deployment-2026)
- **GCC High roadmap updates:** Planet Technologies' GCC High roadmap updates (May 21 and July 23, 2026) track Copilot features for government clouds. One describes a delete control for meeting-generated recaps in government clouds. — [Planet Technologies, May 2026](https://go-planet.com/gcc-high-in-the-know/gcc-high-microsoft-365-roadmap-updates-may-21-2026/)
- **Copilot scheduling target:** Copilot chat-based scheduling is reported as targeting GCC, GCC High and DoD for October 2026 (aggregator, unverified). — [WindowsForum](https://windowsforum.com/news/microsoft-365-copilot-scheduling-targets-gcc-gcc-high-and-dod-for-october-2026.447819/)
- **Webex:** Cisco's Webex developer documentation lists meeting summaries as not supported for Webex for Government (FedRAMP), at least for the API. Third-party review sites claim the AI Assistant is FedRAMP authorized, which conflicts with this. — [Webex developer docs](https://developer-portal-t.wbx2.com/meeting/docs/api/v1/meeting-summaries); [Cisco Webex for Government FedRAMP page](https://www.cisco.com/c/en/us/td/docs/voice_ip_comm/cloudCollaboration/WebexforGovernment/webex-for-government-fedramp-authorized.html); contradicted by [summarizemeeting.com (third-party review)](https://summarizemeeting.com/en/tool/cisco-webex)
- **Webex summer 2026 release:** Cisco's summer 2026 "What's New" page describes real-time meeting summaries in the FedRAMP-authorized Webex app and a "Notetaker Agent". The snippet did not make clear whether the Notetaker Agent is in the FedRAMP boundary. — [Webex What's New, Summer 2026](https://www.webex.com/us/en/whats-new/2026/summer-release.html)
- **FedRAMP AI prioritization:** The FedRAMP AI prioritization track (Aug 2025 to April 2026) certified ChatGPT Enterprise and API, Gemini for Government, and Perplexity Enterprise Pro for Government. No meeting notetakers appeared, and one source says the track is closed to new entrants. — [vdf.ai (secondary)](https://vdf.ai/blog/fedramp-ai/); [FedRAMP AI page](https://www.fedramp.gov/ai/)
- **Standalone notetakers:** I found no evidence that Otter.ai, Fireflies or Read.ai holds a FedRAMP authorization or a government edition. Search found none, and I could not check the marketplace directly. — [search result set incl. FedRAMP AI](https://www.fedramp.gov/ai/)

### Inferences
- An approved government notetaker today almost always means the AI feature of an incumbent platform (Zoom for Gov, M365 GCC or GCC High, Webex for Gov). Microsoft's gaps in meeting recap for GCC High and DoD leave a real window for tools that need no new cloud boundary.
- A small vendor is unlikely to get FedRAMP authorization quickly. An on-device architecture that sends no meeting data to the vendor's cloud may fall outside FedRAMP scope, making it a desktop software-approval question (ATO or agency software list) instead. That is an inference; confirm it with an agency CISO or FedRAMP guidance.

### Gaps
- Marketplace.fedramp.gov was not checked directly, so I could not confirm current scopes for Zoom, Webex or Microsoft.
- I found no data on adoption counts, such as how many agencies have Copilot meeting recap turned on.

## 3. How contractors are told to behave (personal AI tools in client meetings)

### Takeaway
I found no binding federal rule that names "AI notetakers" for contractors. In practice the rule comes from three layers: agency rules of behavior and the "unapproved AI tools are prohibited" posture; contract clauses on CUI (DFARS 252.204-7012 and CMMC); and company acceptable-use policies that bar personal or consumer AI accounts. Most published guidance found is consultant or vendor material.

### Cited Findings
- **CUI and personal AI tools:** DoD-contractor guidance advises against entering CUI into personal AI tools, including consumer transcription tools and unsanctioned plug-ins. It recommends naming approved tools explicitly in policy, since most commercial meeting assistants will not be authorized for CUI-adjacent meetings. — [GS Consulting](https://gsconsultingllc.com/insights/dod-contractors-ai-cui-risk); [Secureframe](https://secureframe.com/blog/cmmc-level-2-ai-governance)
- **Where CUI belongs:** A CMMC guide says CUI belongs in government-cloud AI such as Microsoft 365 Copilot in GCC High, and that personal and free AI accounts are not allowed for work. — [VSO Inc.](https://vso-inc.com/how-to-use-ai-without-breaking-cmmc-compliance-a-defense-contractors-guide/)
- **Client-meeting conflicts:** A policy guide warns that a personal notetaker at a client meeting may conflict with confidentiality, no-recording or data-processing terms in the client agreement. It recommends approved tools, company-managed accounts and defined retention. — [Good Transformer](https://goodtransformer.ai/insights/ai-notetakers-in-client-meetings/)
- **Someone else's bot:** A security series covers "someone else's bot joins the call", the situation contractors face when client or partner bots appear. — [Treo Solutions](https://treo.solutions/blogs/ai-security-series/05-meeting-ai)
- **Association policy example:** ASAE publishes an AI notetaking policy for its meetings, an example of a host-side rule that outside participants must follow. — [ASAE](https://www.asaecenter.org/about-us/policies/ai-notetaking-policies)
- **Enforcement by memo:** The DoD posture, per commentary, is to restate that unapproved AI tools are prohibited (Nov 2026). — [Washington Technology](https://www.washingtontechnology.com/opinion/2026/11/pentagon-wont-stop-rogue-ai-another-memo/417129/)
- **Vendor view [vendor marketing]:** One vendor recommends prohibiting cloud transcription for any meeting touching ITAR, CUI or proprietary contract information. — [basilai.app (vendor)](https://basilai.app/articles/2026-04-23-ai-meeting-transcription-government-contractors-classified-discussions-itar-on-device-privacy.html)

### Inferences
- The default contractor behavior is "don't bring your own notetaker; use the client's platform features if the client turns them on." A vendor product aimed at contractors must be sanctioned by the contractor's own security program (for CMMC, inside its assessed boundary) *and* tolerated by the agency host.
- Host-visible bots are the main source of friction. An on-device tool that captures only the user's own machine audio still raises consent questions in all-party-consent states, and possibly records-retention questions too.

### Gaps
- I found no published agency Rules of Behavior text that names AI notetakers.
- I found no examples of large integrators' (Booz Allen, Leidos, Accenture Federal) internal policies.

## 4. Procurement paths for a small vendor and how long they take

### Takeaway
GSA MAS typically takes about 3 to 6 months for a clean offer, and up to 6 to 18 months with deficiency rounds. A new firm may need the Startup Springboard route, which as of Refresh 33 (Oct 2026) reportedly requires an agency sponsor via FASt Lane. Timelines for SBIR, OTA, CSO and state cooperative contracts were not established in this session.

### Cited Findings
- **MAS timeline:** Estimates for GSA MAS run from offer to award in about 3 to 12 months; 4 to 6 months is typical, and 3 to 6 months for a clean offer. With multiple deficiency rounds the range is 6 to 18 months. These are consultant blogs, not GSA. — [GovPath Strategies](https://govpathstrategies.com/gsa-schedule-mas-guide); [Win A Contract](https://govcon.winacontract.com/blog/how-to-get-on-a-gsa-schedule); [Blackfyre](https://www.blackfyre.app/blog/gsa-schedule-mas-complete-guide)
- **Startup eligibility:** The usual bar is two years in business. Startup Springboard accepts alternatives to two years of experience, and as of Refresh 33 (Oct 2026) those offers reportedly go through FASt Lane and need a federal agency sponsor (consultant source, verify on buy.gsa.gov). — [GovScout](https://govscout.pro/blog/gsa-schedule-for-beginners-2026)
- **Fee and submission:** The Industrial Funding Fee is 0.75% of schedule sales, paid quarterly, and offers are submitted via eOffer. — [GSA Schedule Services](https://www.gsascheduleservices.com/blog/gsa-multiple-award-schedule-your-2026-smb-guide/)
- **Refresh notices:** GSA's Interact feed carries the MAS refresh and mass-modification notices. — [buy.gsa.gov Interact](https://buy.gsa.gov/interact/community/6/activity-feed)
- **State gatekeeper example:** Georgia requires GTA prior authorization for transcription and note-taking AI. — [GTA](https://gta.georgia.gov/policies-and-programs/artificial-intelligence/ai-tool-use)

### Inferences
- For a privacy-first notetaker, the fastest realistic path is probably a direct or micro-purchase pilot with a local government or a single agency office, combined with that body's IT or AI approval process (as in Georgia). A schedule contract is a later scale step, and an agency sponsor may be needed anyway under FASt Lane. This is an inference, not sourced.

### Gaps
- SBIR (Phase I and II award timelines), OTAs (DIU CSO timelines), the FedRAMP 20x Low timeline, and state cooperative contracts (NASPO ValuePoint, Sourcewell, OMNIA, TIPS) were not researched; I hit the tool-call budget.

## 5. On-device or offline transcription in high-security settings

### Takeaway
I found vendor products that market offline or air-gapped speech-to-text to government and healthcare (Speechmatics on-device, Kranium AirScribe, Meetily). None of the results confirmed a specific government, court or DoD accreditation for these tools. The selling point offered is that no audio leaves the device; there is no evidence of formal approvals.

### Cited Findings
- **Speechmatics [vendor marketing]:** Speechmatics markets an on-device model for Mac and Windows as "air-gapped ready". It lists ISO 27001, SOC 2 Type II, HIPAA and GDPR, and names no government authorization. — [Speechmatics](https://www.speechmatics.com/speech-to-text/on-device)
- **Kranium AirScribe [vendor marketing]:** Kranium AI (India) markets AirScribe as offline speech-to-text for government, with no accreditation cited. The page is about a year old. — [Kranium AirScribe](https://kraniumai.com/airscribe-powering-government-with-offline-speech-to-text/)
- **Meetily [vendor marketing]:** Meetily is an open-source local transcription tool (Whisper or Parakeet) described as fitting air-gapped use, with no named approvals. — [Meetily](https://meetily.ai/ai-transcription)
- **Academic context:** An academic paper on an offline dictation system notes that lawyers, clinicians and researchers under data agreements often cannot send speech to third parties. This is a research prototype, not deployed in government. — [arXiv 2607.28878](https://arxiv.org/pdf/2607.28878)

### Inferences
- What reportedly makes on-device tools acceptable is architectural: no third-party data processor, no bot in the meeting, and data stays inside the existing device boundary. These tools still go through the agency's software-approval or ATO process. This is inferred from the policy patterns in sections 1 and 3, not from a documented approval case.

### Gaps
- I found no sourced examples of courts (digital court reporting), the VA (ambient scribe pilots) or DoD units using offline transcription, or of their approval criteria. A targeted search was not possible within the budget.

## 6. Market signals: demand and federal employee AI use

### Takeaway
Agency AI adoption is broad but shallow. OMB's inventory lists 3,611 use cases across 56 agencies, and vendor polls claim 96% of agencies have incorporated AI. I found no survey measuring federal employees' use of AI notetakers specifically.

### Cited Findings
- **OMB inventory:** The consolidated federal AI use-case inventory lists 3,611 use cases across 56 agencies, more than double the 1,757 reported for 2024. — [Precision Federal (secondary)](https://precisionfederal.com/insights/federal-ai-use-cases-by-agency-2026)
- **Workday poll [vendor-sponsored]:** A Workday and Market Connections poll (June 2026, n=200 federal civilian and defense IT respondents) found 96% say their agency has incorporated AI into workflows and 42% report a positive impact. Uptake is described as shallow. — [Workday](https://www.workday.com/en-us/perspectives/ai/federal-agency-ai-adoption.html)
- **ServiceNow poll [vendor-sponsored]:** A Market Connections and ServiceNow poll (reported May 2026) found 53% of federal tech executives say their agencies are exploring or planning agentic AI pilots. — [Nextgov/FCW](https://www.nextgov.com/artificial-intelligence/2026/05/survey-more-half-federal-agencies-now-planning-agentic-ai-pilots/413324/)
- **Employee surveys:** From 2026, agencies run their own annual employee surveys instead of the OPM-run FEVS. Commentary (Oct 2026) argues these should measure what drives AI resistance. — [FedSmith](https://www.fedsmith.com/2026/10/29/federal-employee-survey-should-reveal-what-is-really-driving-ai-resistance/)
- **Workforce readiness:** FedScoop argues adoption metrics miss the workforce "human factor". — [FedScoop](https://fedscoop.com/federal-ai-adoption-the-human-factor/)
- **Local-level demand:** The Aurora, CO staff discussion and the Bellevue and Georgia policies (section 1) show that staff are already using notetakers enough to prompt policy responses. — see section 1 sources

### Inferences
- Demand clearly exists. The Bellevue and Georgia rules exist because staff were bringing notetakers in, and Microsoft's roadmap is prioritizing meeting recap for government clouds. The binding constraint is approval, not interest.

### Gaps
- I found no federal-employee survey on AI notetaker use specifically, and no state or local spending data for meeting AI tools.
