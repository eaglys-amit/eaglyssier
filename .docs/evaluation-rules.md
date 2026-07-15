**Individual-Commitment Balanced Engineering Scorecard**.

Since each team members explicitly commit to a specific number of story points during Sprint Planning (backed by Scrum Poker calibration), we can precisely calculate their **individual reliability** alongside their **technical execution**.

This framework normalizes Jira and GitHub data into a standardized **100-Point Performance Score** per developer, calculated at the end of each evaluation period (e.g., quarterly or over a 3-sprint rolling average).

The 100-Point Evaluation Matrix
-------------------------------

| **Evaluation Pillar** | **Specific Metric** | **Data Source** | **Max Points** |
| --- | --- | --- | --- |
| **1\. Sprint Commitment & Delivery** | Individual Say-Do Ratio & Point Volume | Jira | **40 Points** |
| **2\. Code Quality & Engineering** | PR Cycle Time & Code Review Engagement | GitHub | **40 Points** |
| **3\. Scrum Citizenship** | Active PBR & Scrum Poker Engagement | Qualitative Rubric | **20 Points** |
| **Total Score** |  |  | **100 Points** |

Step-by-Step Mathematical Calculations
--------------------------------------

### Pillar 1: Sprint Commitment & Delivery (Max 40 Points)

This pillar directly measures the individual story points a developer commits to versus what they actually move to "Done" by the end of the sprint.

#### A. Individual Say-Do Reliability (Max 20 Points)

This tracks how accurately a developer delivers on their personal sprint promises.

$$\text{Individual Say-Do Ratio} = \left( \frac{\text{Story Points Completed in Sprint}}{\text{Story Points Individually Committed at Sprint Start}} \right) \times 100\%$$

-   **Scoring Rules:**

    -   **85% to 100% Delivery:** **20 Points** (Perfect execution and highly predictable)

    -   **70% to 84% Delivery:** **15 Points** (Good, but slightly overcommitted or hit minor blockers)

    -   **50% to 69% Delivery:** **10 Points** (Systemic over-promising or poor breakdown of tasks)

    -   **Below 50% OR Above 120%:** **5 Points** (Below 50% means major failure to deliver; Above 120% means "sandbagging"---deliberately committing to too few points to look good).

#### B. Delivered Volume vs. Seniority Target (Max 20 Points)

Reliability is great, but a Senior developer committing to and finishing only 3 points is underperforming. We evaluate total completed points against a baseline tailored to their role level.

$$\text{Volume Performance} = \left( \frac{\text{Total Story Points Completed}}{\text{Expected Seniority Baseline}} \right) \times 100\%$$

> **Suggested Baseline Targets (Per Sprint):**
>
> -   **Junior Developer:** 5 -- 8 Story Points
>
>
> -   **Mid-Level Developer:** 12 -- 15 Story Points
>
>
> -   **Senior Developer:** 20+ Story Points

-   **Scoring Rules:**

    -   $\ge 100\%$ of Seniority Baseline: **20 Points**

    -   $80\%$ to $99\%$ of Seniority Baseline: **15 Points**

    -   $60\%$ to $79\%$ of Seniority Baseline: **10 Points**

    -   $< 60\%$ of Seniority Baseline: **5 Points**

### Pillar 2: Technical Contribution & Quality (Max 40 Points)

This ensures developers aren't just rushing through story points while leaving broken code or unreviewed pull requests behind.

#### A. PR Cycle Time / Speed to Value (Max 20 Points)

Measures the average hours from the moment a developer opens a Pull Request on GitHub to the moment it is merged into the main branch.

$$\text{PR Cycle Time} = \text{Timestamp of PR Merge} - \text{Timestamp of PR Open}$$

-   **Scoring Rules:**

    -   **Under 24 hours:** **20 Points** (Code is clean, bite-sized, and easily reviewable)

    -   **24 to 48 hours:** **15 Points** (Standard, healthy pace)

    -   **48 to 72 hours:** **10 Points** (PRs are too large or developer is slow to address feedback)

    -   **Over 72 hours:** **5 Points** (Code sits in limbo, creating merge conflicts and blocking value)

#### B. Code Review Engagement Ratio (Max 20 Points)

Measures team collaboration. A great developer helps clear the peer-review queue.

$$\text{Review Ratio} = \frac{\text{Number of Peer PRs Reviewed/Commented}}{\text{Number of Personal PRs Authored}}$$

-   **Scoring Rules:**

    -   **Ratio $\ge$ 1.0:** **20 Points** (Excellent citizen; reviews at least as much as they submit)

    -   **0.6 to 0.9:** **15 Points** (Solid team contributor)

    -   **0.3 to 0.5:** **10 Points** (Relies heavily on others to get code merged without giving back)

    -   **Below 0.3:** **5 Points** (Isolated coder; bottlenecking the team's GitHub pipeline)

### Pillar 3: Process & Agile Citizenship (Max 20 Points)

Because your team utilizes a strict **Product Backlog Refinement (PBR)** and **Scrum Poker** system, individual performance during these alignment sessions matters. This is evaluated via a manager/Scrum Master rubric.

-   **16 -- 20 Points (Expert):** Arrives at PBR sessions having already read the PBIs; actively flags architectural risks; explains outliers during Scrum Poker voting to drive team alignment; helps juniors understand complex tasks.

-   **11 -- 15 Points (Strong):** Consistently participates in PBR, asks clarifying questions before voting, votes intentionally rather than following the crowd.

-   **6 -- 10 Points (Passive):** Attends sessions but rarely speaks; practices "herd mentality" voting (waiting to see what seniors vote in Scrum Poker and matching it).

-   **0 -- 5 Points (Disruptive):** Unprepared for PBR; skips sessions or checks out mentally; routinely guesses on story points without understanding requirements.

Final Performance Evaluation Tiers
----------------------------------

At the end of the evaluation cycle, aggregate the scores from all three pillars:

-   **95 -- 100 Points | Elite Performer:** Perfectly calibrates commitments, hits deadlines, maintains fast PR turnarounds, and acts as a technical anchor during Scrum Poker. Ready for promotion.

-   **80 -- 94 Points | Strong Core Contributor:** The backbone of your team. Highly predictable delivery on individual commitments with good code quality.

-   **60 -- 79 Points | Targeted Coaching Required:** Delivering inconsistently. Usually characterized by missing committed sprint points (low Say-Do) or letting PRs stall on GitHub.

-   **Below 60 Points | Performance Action Needed:** Systemic underperformance. The individual is either chronically overestimating their capacity, ignoring team code reviews, or disengaged from the PBR process.