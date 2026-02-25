# CloudForge - Autonomous AI Coding Orchestrator

## Purpose

CloudForge is an autonomous innovation-driven development orchestrator that drives an AI coding agent through structured engineering phases to complete software tasks with zero user intervention. It embeds industry-standard methodologies (IREB, DDD, BDD, TDD, ISTQB, MoSCoW) and uses innovation gates with KPIs to ensure quality. It spawns the agent as a subprocess multiple times with phase-specific prompts, maintains session continuity, handles rate limits with countdown/auto-retry, and streams output in real-time. Innovation rounds automatically loop back to discover further improvements until max iterations are reached.

## How It Works

CloudForge invokes the AI agent CLI in a structured loop of 18 phases:

```
DISCOVER -> REQUIREMENTS -> PRIORITIZE -> [GATE_SCOPE]
   -> DOMAIN -> DESIGN -> BDD -> PLAN -> PROTOTYPE -> [GATE_DESIGN]
   -> *TEST -> *IMPLEMENT -> *VERIFY -> *REFACTOR (per sub-task)
   -> INTEGRATE -> [GATE_QUALITY]
   -> REVIEW -> INNOVATE -> (loop back to DISCOVER or finish)
```

### Phase Details

| #   | Phase        | Methodology                      | Purpose                                                                                |
| --- | ------------ | -------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | DISCOVER     | IREB elicitation                 | Explore problem space, codebase, stakeholders, risks                                   |
| 2   | REQUIREMENTS | IREB specification, User Stories | Write user stories with acceptance criteria, functional/non-functional requirements    |
| 3   | PRIORITIZE   | MoSCoW, MVP, KPIs                | Classify Must/Should/Could/Won't, define MVP scope, set measurable KPIs                |
| 4   | GATE_SCOPE   | Innovation Gate 1                | Validate requirements completeness, testability, feasibility. Go/No-Go                 |
| 5   | DOMAIN       | DDD                              | Model bounded contexts, entities, value objects, aggregates, domain events             |
| 6   | DESIGN       | Architecture                     | Technical design, component interfaces, data flow, error handling strategy             |
| 7   | BDD          | Behavior-Driven Development      | Write Given/When/Then scenarios for all Must-have stories                              |
| 8   | PLAN         | Implementation Planning          | Break work into ordered atomic sub-tasks, write `.cloudforge/plan.md`                  |
| 9   | PROTOTYPE    | Technical Spike                  | Validate riskiest assumption with minimal proof-of-concept, then clean up              |
| 10  | GATE_DESIGN  | Innovation Gate 2                | Validate design, BDD coverage, plan quality, prototype results. Go/No-Go               |
| 11  | TEST*        | TDD + ISTQB                      | Write failing tests using equivalence partitioning, boundary analysis, decision tables |
| 12  | IMPLEMENT*   | TDD Green Phase                  | Write minimal code to pass tests, following DDD domain model                           |
| 13  | VERIFY*      | ISTQB Verification               | Run full test suite, check coverage, verify BDD traceability                           |
| 14  | REFACTOR*    | TDD Refactor + DDD               | Clean up code, ensure DDD alignment, ubiquitous language                               |
| 15  | INTEGRATE    | ISTQB Integration/System         | Cross-component integration tests, E2E scenarios, regression testing                   |
| 16  | GATE_QUALITY | Innovation Gate 3                | Evaluate all KPIs, acceptance criteria, coverage targets. Go/No-Go                     |
| 17  | REVIEW       | Documentation                    | Final code review, update docs, requirements traceability check                        |
| 18  | INNOVATE     | Innovation Round                 | Assess completeness, identify Should-have improvements, loop or finish                 |

*Phases marked with* are the task loop - repeated for each sub-task from the plan.

### Innovation Rounds

When INNOVATE determines there are undelivered Must-have items or high-value Should-have improvements, it triggers a new innovation round (NEEDS_RETRY -> DISCOVER). The circuit breaker's max iterations limit prevents infinite looping. When the task is fully complete, INNOVATE reports DONE and the workflow finishes.

### Innovation Gates

Three quality gates act as stage-gate checkpoints:

- **GATE_SCOPE**: Are requirements complete, testable, feasible? If not -> back to REQUIREMENTS.
- **GATE_DESIGN**: Is the design sound, BDD complete, plan realistic? If not -> back to DESIGN.
- **GATE_QUALITY**: Do all KPIs pass? If not -> back to INTEGRATE.

Gates that fail beyond max retries proceed anyway to prevent deadlocks.

### Artifacts

CloudForge produces these artifacts in `.cloudforge/`:

- `state.json` - Workflow state (resumable)
- `stories.md` - Living story/feature tracker with IDs, priorities, and statuses
- `plan.md` - Implementation plan with numbered sub-tasks linked to stories
- `requirements.md` - IREB requirements and user stories with MoSCoW classification
- `kpis.md` - Measurable KPI definitions
- `domain.md` - DDD domain model
- `bdd-scenarios.md` - BDD Given/When/Then scenarios
- `quality-report.md` - KPI evaluation results from quality gate
- `innovation-log.md` - Innovation round assessments
- `prd/` - Per-feature Product Requirements Documents (one `.md` per feature/epic)

Session continuity is maintained via `--resume <session-id>` so the agent retains full context across all phases.

## Build/Test/Run Guidelines

### Prerequisites

- Node.js (any version supporting CommonJS)
- An AI coding agent CLI installed and accessible (e.g. `claude` command or `cli.js`)

### Running

```bash
# Direct invocation
node forge.js "Your task description here"

# Auto-resume (picks up where it left off from .cloudforge/)
node forge.js

# Via batch launcher (sets up environment)
cloudforge "Your task description here"

# With options
node forge.js "Add JWT auth" --max-iterations 50 --model opus --working-dir ./myproject

# Dry run (show plan without executing)
node forge.js "Add JWT auth" --dry-run

# Resume a previous session (legacy, prefer auto-resume)
node forge.js --continue-session <session-id>
```

### CLI Arguments

| Argument              | Default       | Description                                              |
| --------------------- | ------------- | -------------------------------------------------------- |
| `[task]` (positional) | optional      | Task description (auto-resumes from .cloudforge/ if omitted) |
| `--max-iterations`    | `25`          | Max total agent invocations (controls innovation rounds) |
| `--max-phase-retries` | `3`           | Max retries per phase before moving on                   |
| `--model`             | auto          | Model (sonnet/opus/haiku)                                |
| `--working-dir`       | `cwd`         | Project directory                                        |
| `--max-turns`         | `50`          | Max agentic turns per invocation                         |
| `--continue-session`  | `null`        | Resume previous session by ID (legacy)                   |
| `--dry-run`           | `false`       | Show planned phase sequence without executing            |
| `--rate-limit-wait`   | `43200` (12h) | Max seconds to wait on rate limit                        |
| `-v, --verbose`       | `false`       | Show debug output (spawn cmd, stderr, events)            |

### Testing

```bash
node --test Forge/tests/
```

## Structure

```
Forge/
  forge.js              # Main entry point - CLI + orchestrator
  forge.bat             # Windows launcher
  lib/
    tui.js              # Terminal UI rendering (ANSI colors, timestamps, progress)
    runner.js           # Agent subprocess spawn + stream-json parsing
    ratelimit.js        # Rate limit detection, countdown timer, auto-retry
    phases.js           # Phase engine, workflow.dot parser, template system
    state.js            # Workflow state, progress tracking, circuit breaker
  prompts/
    workflow.dot        # Workflow state machine (DOT-like graph format)
    discover.txt        # IREB elicitation
    requirements.txt    # IREB specification + user stories
    prioritize.txt      # MoSCoW + MVP + KPIs
    gate_scope.txt      # Innovation Gate 1
    domain.txt          # DDD domain modeling
    design.txt          # Architecture design
    bdd.txt             # BDD scenarios
    plan.txt            # Implementation planning
    prototype.txt       # Technical spike
    gate_design.txt     # Innovation Gate 2
    test.txt            # TDD + ISTQB test design
    implement.txt       # TDD green phase
    verify.txt          # ISTQB verification
    refactor.txt        # TDD refactor + DDD alignment
    integrate.txt       # ISTQB integration/system testing
    gate_quality.txt    # Innovation Gate 3 + KPI evaluation
    review.txt          # Final review + documentation
    innovate.txt        # Innovation round assessment
    status_tag.txt      # Shared CLOUDFORGE_STATUS block template
  tests/
    tui.test.js         # TUI unit tests (30 tests)
    runner.test.js      # Runner unit tests (27 tests)
    ratelimit.test.js   # Rate limit handler tests (33 tests)
    phases.test.js      # Phase engine tests (89 tests)
    state.test.js       # State manager tests (79 tests)
  ReadMe.md
```

### Architectural Patterns

- **Zero dependencies** - Uses only Node.js built-in modules (`child_process`, `readline`, `fs`, `path`, `os`)
- **Data-driven workflow** - Phase sequence and transitions defined in `prompts/workflow.dot`
- **Editable prompts** - Each phase's prompt is a `.txt` template with `{placeholder}` substitution
- **Methodology-driven** - IREB, DDD, BDD, TDD, ISTQB, MoSCoW embedded in phase prompts
- **Innovation loops** - INNOVATE phase can restart the workflow for continuous improvement
- **Session continuity** - Uses `--resume` to maintain conversation context across phases
- **Circuit breaker** - Detects stuck loops and halts gracefully
- **Stream processing** - Parses `stream-json` output line-by-line for real-time display

## Features

- [x] 18-phase innovation-driven development workflow
- [x] IREB requirements engineering (DISCOVER, REQUIREMENTS)
- [x] Per-feature PRD generation (REQUIREMENTS, validated in GATE_SCOPE/REVIEW)
- [x] Living story/feature tracker with status lifecycle (REQUIREMENTS -> VERIFY -> REVIEW)
- [x] INVEST enforcement on all stories (REQUIREMENTS, GATE_SCOPE)
- [x] KISS/YAGNI discipline throughout implementation (DESIGN, PLAN, IMPLEMENT, REFACTOR, gates)
- [x] Semantic type enforcement - domain concepts as distinct types, not bare primitives (DOMAIN, DESIGN, IMPLEMENT, REFACTOR, gates)
- [x] MoSCoW prioritization and MVP scope definition (PRIORITIZE)
- [x] DDD domain modeling (DOMAIN, enforced in IMPLEMENT/REFACTOR)
- [x] BDD behavior scenarios (BDD, referenced in TEST/VERIFY)
- [x] TDD red-green-refactor cycle (TEST, IMPLEMENT, REFACTOR)
- [x] ISTQB test design techniques (TEST, VERIFY, INTEGRATE)
- [x] Innovation gates with go/no-go decisions (GATE_SCOPE, GATE_DESIGN, GATE_QUALITY)
- [x] KPI definition and evaluation (PRIORITIZE, GATE_QUALITY)
- [x] Technical prototyping/spikes (PROTOTYPE)
- [x] Innovation rounds with automatic looping (INNOVATE -> DISCOVER)
- [x] Integration and system testing (INTEGRATE)
- [x] Data-driven workflow state machine (`prompts/workflow.dot`)
- [x] Editable prompt templates (`prompts/*.txt`)
- [x] Agent subprocess management with stream-json parsing
- [x] Session continuity via `--resume`
- [x] Rate limit detection with +30s safety buffer
- [x] Absolute reset time parsing ("resets 1am" format)
- [x] Countdown timer with auto-retry and exponential backoff
- [x] Phase progress bar visualization (workflow position indicator per phase)
- [x] Evidence-based verification - VERIFY/GATE_QUALITY/REVIEW/INNOVATE require concrete proof (test output, code inspection)
- [x] Reachability enforcement - features must be wired into the application, not just tested in isolation (IMPLEMENT, VERIFY, INTEGRATE, GATE_QUALITY, REVIEW)
- [x] Real-time streaming output with ANSI colors and timestamps
- [x] State persistence and resume support (`.cloudforge/state.json`)
- [x] Auto-resume from `.cloudforge/` when no arguments given
- [x] Artifact-based state recovery (corrupt/missing `state.json` fallback)
- [x] Circuit breaker (stuck detection)
- [x] Dry-run mode
- [x] Graceful Ctrl+C shutdown with state save
- [x] Verbose/debug mode (`-v`)
- [x] Agent crash detection

## Planned Features

- [ ] Multi-project orchestration (run CloudForge across multiple repos)
- [ ] HTML report generation for completed runs
- [ ] Cost tracking and budget limits
- [ ] Parallel sub-task execution
- [ ] Pluggable agent backends

## Customizing the Workflow

The phase sequence and transitions are defined in `prompts/workflow.dot` using a DOT-like graph syntax:

```
# Phases marked with * are part of the task loop (repeated per sub-task)
DISCOVER        -> REQUIREMENTS    [done]
DISCOVER        -> DISCOVER        [retry]

GATE_SCOPE      -> DOMAIN          [done]
GATE_SCOPE      -> REQUIREMENTS    [retry]
GATE_SCOPE      -> DOMAIN          [retry_exhausted]

*TEST           -> IMPLEMENT       [done]
*VERIFY         -> IMPLEMENT       [retry]
*VERIFY         -> REFACTOR        [retry_exhausted]

*REFACTOR       -> INTEGRATE       [done]
*REFACTOR       -> TEST            [done_next_subtask]

INNOVATE        -> DISCOVER        [retry]
INNOVATE        -> END             [done]
```

**Syntax:**

- `PHASE -> NEXT [condition]` - Define a transition
- `*PHASE` - Mark as task-loop phase (repeated per sub-task from plan.md)
- `END` - Terminal state (workflow complete)
- `#` - Comments (inline or full-line)
- Conditions: `done`, `retry`, `retry_exhausted`, `done_next_subtask`

**To add a phase:** Add its transitions to `workflow.dot` and create `prompts/<phase_lowercase>.txt`.

**To remove a phase:** Delete its lines from `workflow.dot`.

### Prompt Templates

Each phase loads its prompt from `prompts/<phase_name_lowercase>.txt`. Templates support `{placeholder}` substitution:

- `{task}` - The task description
- `{subTaskNumber}` - Current sub-task number
- `{totalSubTasks}` - Total sub-tasks from plan
- `{workingDir}` - Working directory path
- `{status_tag}` - Expands to the shared CLOUDFORGE_STATUS block from `status_tag.txt`

## Known Bugs and Limitations

- Windows-only batch launcher (Linux/Mac users invoke `node forge.js` directly)
- Relies on an AI coding agent CLI being installed and the `claude` command or `cli.js` being accessible
- Rate limit detection is heuristic-based; unusual error formats may not be caught
- Circuit breaker uses a simple consecutive-failure count; sophisticated progress detection (e.g., partial file changes) is not implemented
- `.cloudforge/plan.md` parsing assumes a specific numbered-list format from the agent's output
- No encryption or access control on `.cloudforge/state.json`
- Innovation rounds depend on the agent's judgment in the INNOVATE phase for loop-or-stop decisions

## Security Implications

- CloudForge passes `--dangerously-skip-permissions` to the agent, granting it unrestricted filesystem and command access within the working directory
- State files in `.cloudforge/` may contain sensitive task descriptions
- The orchestrator does not sandbox the agent's operations beyond what the agent itself provides
