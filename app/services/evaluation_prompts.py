"""HR-authored MBO FORM② content and LLM prompts for evaluation sheets.

Transcribed from the two HR-distributed Excel files (repo root):
- "Tech Unit MBO人事評価シート Revised MBO Evaluation Sheet for Tech Unit 【260209改正】.xlsx"
  → sheet "Each_Project" (the FORM② layout and S–E scale)
- "FORM①②_Check List＋Prompt【English】.xlsx"
  → sheets "FORM2 Checklist" (16 check items) and "FORM2 Prompt" (checker prompt,
    grade definitions)

The checker prompt is HR's verbatim text adapted only to (a) check a serialized
sheet instead of an uploaded Excel file and (b) reply in strict JSON for the
analyzer contract (see app.services.analyzers).
"""
from __future__ import annotations

GRADE_SCALE = {"S": 120, "A": 110, "B": 100, "C": 90, "D": 80, "E": 70}
GRADES = ["S", "A", "B", "C", "D", "E"]

# (key, label, value bucket, guiding question) — buckets per the FORM2 Prompt sheet:
# Feasibility≒ = Outcomes/Cost/Delivery, Unique≒ = Value/Quality, Inclusive≒ = Ownership.
AXES: list[tuple[str, str, str, str]] = [
    ("outcomes", "Outcomes", "Feasibility",
     "What are the expected deliverables, defined as a completed state?"),
    ("value", "Value (Business Impact)", "Unique",
     "What benefit do the Outcomes bring to the organization or customers?"),
    ("cost", "Cost (Human-hour / Focus Factor)", "Feasibility",
     "How much effort (Focus Factor) and capital/external cost will be invested, "
     "and how is investment efficiency optimized?"),
    ("quality", "Quality", "Unique",
     "What level of results are targeted, and how is quality built in to meet "
     "stakeholder expectations?"),
    ("delivery", "Delivery", "Feasibility",
     "How will agreed deadlines be met while adapting to change and maximizing "
     "delivery speed (cadence, adaptability)?"),
    ("ownership", "Ownership", "Inclusive",
     "How is accountability fulfilled (including for AI-generated code), and how "
     "do you support and empower others toward an autonomous team culture?"),
]

AXIS_KEYS = [k for k, *_ in AXES]

# Verbatim from the "FORM2 Prompt" sheet: positioning + grade definitions.
FORM2_CONTEXT = """\
## Positioning of FORM②
- FORM② is the sheet created for each individual project and evaluated by the Tech Lead
- Correspondence between the 6 evaluation axes and Value:
  - Feasibility≒: Outcomes (degree of achievement) / Cost (work allocation/investment efficiency) / Delivery (deadline/adaptability)
  - Unique≒: Value-Business Impact (conversion of expertise into business value) / Quality (technical quality judgment)
  - Inclusive≒: Ownership (accountability + team contribution)
- FORM② should describe specific project-specific goals and KPIs. Annual policy, cross-project initiatives, and self-development should be written in FORM①

## Rating scale (Achievement Level)
- S = 120 (+20): Exceeding targets by a wide margin and consistently delivering outstanding results
- A = 110 (+10): Consistently achieving results that exceed expectations
- B = 100 (As Planned): Achieving goals and consistently delivering solid results
- C = 90 (-10): While falling short of the target, efforts and continuous improvement are evident
- D = 80 (-20): Effort is evident, but results are inconsistent
- E = 70 (-30): Lacking in results and effort, with no sign of improvement

## Grade Definitions (Tech Unit: Professional / Specialist)

### Professional
- G1: Vigorously building a foundation in their area of expertise, able to solve problems using basic knowledge and skills
- G2: Possesses professional/technical problem-solving ability, has established trust within the team, and can be relied upon. Able to consider and implement ideas beyond the existing framework
- G3: Able to contribute using high expertise combined with problem-solving ability, autonomously plan, and deliver proposals that lead to next steps. Has the knowledge and attitude to discuss across specialties and earns high trust within the organization
- G4: Based on extensive experience and high expertise, able to present solutions and new directions for advanced and complex challenges. As a key person, gathers high trust both inside and outside the organization and can lead innovative initiatives
- G5: Active at the forefront of the industry, creates new businesses/technologies/products based on a vision. Reads industry trends, builds a pioneering position that creates the future, and has a major impact on the market

### Specialist
- G1: Possesses basic (master's-level) knowledge, research methods, and analytical skills. Expected to further acquire expertise and accumulate practical research experience
- G2: Has practical experience and can present reliable research results in their core research area. Able to conduct joint research and external presentations leveraging their expertise
- G3 and above: Integrated with Professional G3 and above. Expected to show "direct contribution to customer value, with reproducibility of ability/track record demonstrated by driving multiple projects/themes," or "leading large-scale internal/external product development or project promotion while individually providing sufficiently broad services/value and coverage"\
"""

# The 16 FORM② check items, verbatim from the "FORM2 Prompt" / "FORM2 Checklist"
# sheets: (id, axis group, check question, NG example, OK example).
CHECKLIST_ITEMS: list[tuple[str, str, str, str, str]] = [
    ("O-1", "Outcomes (Feasibility≒)",
     'Is the deliverable defined in a "completed state"? (Not a description of work '
     'such as "in charge of ~", but with clear completion criteria)',
     '"In charge of developing the RAG system" → description of work; completion criteria unclear',
     '"Define the PoC check sheet and complete 100%. Submit the final report."'),
    ("O-2", "Outcomes (Feasibility≒)",
     "Is the deliverable within the scope of this project? (No goals from outside "
     "the project or another project mixed in)",
     '"Independently develop an internal CLI tool in parallel with this project" → a different project or a FORM① matter',
     "All deliverables are directly tied to the purpose/scope of this project"),
    ("V-1", "Value-Business Impact (Unique≒)",
     "Is the business benefit that the Outcomes bring to customers/the organization "
     'explained? (Is "so why is this good" stated?)',
     '"Implemented with the latest architecture" → only technical means; customer value unclear',
     '"Lead the PoC to success, enabling the customer to proceed to the production consideration phase"'),
    ("V-2", "Value-Business Impact (Unique≒)",
     "Is the causal relationship with the Outcomes clear?",
     'Outcomes: "Submit report" → Value: "Increase sales" → causal leap',
     'Outcomes: "Complete check sheet 100% + report" → Value: "Customer can decide on production deployment"'),
    ("C-1", "Cost (Feasibility≒)",
     "Is the Focus Factor (work allocation) stated numerically?",
     '"Focus on this project" / "Devote as much time as possible" → commitment level unclear',
     '"Focus Factor: 0.5" / "PM: 0.3 / TL: 0.2 / Dev1: 0.5 / Dev2: 0.5"'),
    ("C-2", "Cost (Feasibility≒)",
     "Is there an estimate of capital expenditure/external costs? (if applicable; "
     'if not applicable, PASS as long as "not applicable" is clearly stated)',
     '"Plan to use an API" → no cost awareness',
     '"API Token: 150 [K¥/mon]"'),
    ("Q-1", "Quality (Unique≒)",
     "Are the quality standards defined in a measurable form?",
     '"Aim for high-quality deliverables" / "No bugs" → cannot be judged',
     '"Unit test coverage of 80% or higher" / "Attach UT/IT report at delivery"'),
    ("Q-2", "Quality (Unique≒)",
     "Does it reflect quality considerations based on EAGLYS's business characteristics "
     "(confidential computing, AI)? (for projects involving cryptographic processing/"
     "data protection; may be omitted for projects where not applicable)",
     "No mention of security quality standards for a project involving cryptographic processing",
     '"Design separate edge-case and abnormal-case tests for the cryptographic pipeline, reviewed by the Tech Lead"'),
    ("D-1", "Delivery (Feasibility≒)",
     "Are the deadline and milestones specific?",
     '"Deliver as soon as possible" / "Follow the schedule" → deadline unclear',
     '"Clarify and agree on customer requirements within 1 month of project start" / "No delivery delays attributable to EAGLYS"'),
    ("D-2", "Delivery (Feasibility≒)",
     "Does it address measures for adapting to changing circumstances?",
     'Only "Proceed according to plan" → no response to change',
     '"Requirements are ambiguous, so create a working mock via Vibe Coding and clarify requirements within 1 month"'),
    ("W-1", "Ownership (Inclusive≒)",
     "Is accountability for deliverables, including AI-generated code, clearly stated?",
     '"Write and submit the code" → no accountability',
     '"Take accountability even for AI-generated code, and always be able to explain it to the Tech Lead"'),
    ("W-2", "Ownership (Inclusive≒)",
     "Are there specific actions for team contribution, supporting others, and code "
     "review activities?",
     '"Responsibly complete my assigned portion" → only individual task execution',
     '"Propose and have 2+ improvement ideas adopted in retrospectives" / "Raise a junior member\'s competency by one level"'),
    ("G-1", "Overall Consistency",
     "Does every one of the 6 axes have substantive content? (no imbalance)",
     'Outcomes/Quality are thorough, but Cost says "None in particular" and Ownership says "I\'ll do my best"',
     "Specific descriptions tailored to this project across all 6 axes, no major imbalance"),
    ("G-2", "Overall Consistency",
     "Are annual policy, cross-project initiatives, or self-development mixed into FORM②?",
     '"Foster a team quality culture over the year" / "6 technical blog posts per year" → belongs in FORM①',
     "All descriptions are limited to goals within the scope/period of this project"),
    ("G-3", "Overall Consistency",
     'Can the Tech Lead judge the "B (goal achieved)" level for each axis?',
     '"Strive to improve quality" / "Deliver quickly" → no achievement boundary',
     'Outcomes: "Check sheet 100%" / Quality: "Coverage 80%+" / Delivery: "No delivery delay" → B standard per axis'),
    ("G-4", "Overall Consistency",
     "Is the type of evidence to confirm achievement of each axis assumed? (Evidence "
     "to be recorded in the Evidence of Outcomes field: GitHub repository, test "
     "reports, demo videos, etc.)",
     "No mention of evidence; no means to prove achievement at project completion",
     '"Record GitHub repository URLs, test reports, demo videos, customer feedback in Evidence of Outcomes"'),
]

CHECKLIST_IDS = [item[0] for item in CHECKLIST_ITEMS]


def _checklist_block() -> str:
    lines = []
    group = None
    for cid, axis, question, ng, ok in CHECKLIST_ITEMS:
        if axis != group:
            group = axis
            lines.append(f"\n### {axis}")
        lines.append(f"{cid}: {question}")
        lines.append(f"  NG example: {ng}")
        lines.append(f"  OK example: {ok}")
    return "\n".join(lines)


CHECKLIST_PROMPT = f"""\
You are a checker well-versed in EAGLYS Inc.'s HR evaluation system.
Verify the goal descriptions of the FORM② (Each Project) evaluation sheet below \
against the check items.

{FORM2_CONTEXT}

## Check Items
{_checklist_block()}

## Sheet to check
Project: {{project}}
Member: {{name}}

{{sheet}}

## Output
Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{{{"items": [{{{{"id": "O-1", "status": "PASS" or "FAIL",
    "reason": "concise judgment reason in 1-2 sentences",
    "suggestion": "specific direction for revision (null unless FAIL)"}}}},
   ... one entry for each of the 16 check items, in order ...],
  "verdict": "pass" if every item is PASS else "fail"}}}}
"""

GOALS_PROMPT = f"""\
You are drafting the "Planned Goal" column of an EAGLYS FORM② (Each Project) MBO \
evaluation sheet for one team member. Planned Goals are normally written BEFORE \
a project starts; here they are being reconstructed afterwards because the sheet \
was never filled in. Use the member's assigned Jira tasks below ONLY to infer \
their role, responsibility area, and the project's scope — then write the goals \
in forward-looking language, as they would have been written at project start. \
Do NOT mention Jira ticket identifiers, ticket numbers, or refer to specific \
tickets; describe the deliverables themselves. Do not invent scope that the \
tasks don't support.

{FORM2_CONTEXT}

## Authoring rules
The goals you draft must be able to PASS every check item below. In particular:
- Define deliverables as a "completed state" with clear completion criteria \
(what exists and works when done), not as a list of tickets or work items
- State the business benefit and its causal link to the outcomes
- State the Focus Factor numerically; where you cannot know a number (Focus \
Factor, budget), write an explicit placeholder like "(fill in: Focus Factor, \
e.g. 0.5)" rather than inventing one — except placeholders, every axis must \
have substantive project-specific content
- Define quality standards in measurable form (e.g. test coverage thresholds)
- Give specific milestones/deadlines and an adaptability measure
- State accountability (including for AI-generated code) and concrete team \
contribution actions
- Keep everything within this project's scope: no annual policy, cross-project \
initiatives, or self-development (those belong in FORM①)
- For each axis, make the "B (goal achieved)" boundary judgeable by the Tech Lead
- Name the kinds of evidence that will prove achievement (GitHub repo, test \
reports, demo videos, ...)

## Check Items
{_checklist_block()}

## Input
Project: {{project}}
Member: {{name}}

Assigned Jira tasks, for scope/role inference only — do not cite them \
(status · title — description excerpt):
{{tasks}}

## Output
Reply with ONLY a JSON object (no prose, no code fences) mapping each axis to \
its Planned Goal text (2-6 sentences each, may contain line breaks):
{{{{"outcomes": "...", "value": "...", "cost": "...", "quality": "...",
  "delivery": "...", "ownership": "..."}}}}
"""

RESULTS_PROMPT = f"""\
You are filling in the "Key Results & Achievements" column of an EAGLYS FORM② \
(Each Project) MBO evaluation sheet for one team member, based on their actual \
recorded activity in this project. Use ONLY the data below — do not invent \
results. Write results against the member's Planned Goals where they exist, \
noting explicitly what was achieved, exceeded, or not evidenced by the data.

{FORM2_CONTEXT}

## Rating guidance
Suggest a Self Eval grade per axis using the S–E scale above (B = goal achieved \
as planned). Judge against the Planned Goal for that axis; if there is no \
planned goal or the data is insufficient to judge an axis, use null.

## Input
Project: {{project}}
Member: {{name}}

Planned Goals per axis:
{{planned_goals}}

Computed metrics (source of truth — do not contradict these):
{{metrics}}

Completed Jira tasks (key · story points · resolved date · title):
{{tasks_done}}

Commit summaries:
{{commits}}

Pull requests authored (state · title):
{{prs}}

Code reviews given (state · PR title):
{{reviews}}

## Output
Reply with ONLY a JSON object (no prose, no code fences) of this exact shape:
{{{{"axes": {{{{
    "outcomes": {{{{"key_results": "2-5 sentence factual summary grounded in the data",
                  "self_eval": "S"|"A"|"B"|"C"|"D"|"E"|null}}}},
    "value": {{{{...}}}}, "cost": {{{{...}}}}, "quality": {{{{...}}}},
    "delivery": {{{{...}}}}, "ownership": {{{{...}}}}
  }}}},
  "evidence": ["Jira keys, PR numbers, commit SHAs or URLs that evidence the outcomes", "..."]}}}}
"""
