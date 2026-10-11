# Agency

The office of the WebTix agent team, in 3D. Every agent is a file in `agents/`; the office shows who sits where, what each one does and what they are working on, and lets you change all of it.

## Open the office

```bash
node office.mjs
```

Then go to http://localhost:5190. Drag to look around, scroll to zoom, click someone (or pick them in the bar at the bottom).

The office needs this little server and an internet connection (the 3D library loads from a CDN). Opening `index.html` as a file does not work.

## What you can do

- **Change what someone is doing.** Under *Doing now* pick At the desk, Coffee, Walk, Chat or Dance and they go and do it. *Own choice* lets them decide: mostly at the desk, with short breaks.
- **Give a task.** Type it under *Task* and press *Give task*. It waits in the queue with a yellow "Queued" bubble over the agent.
- **Have the tasks carried out.** Tell Claude Code: **run the agency** (or `/run-agency`). Claude hands each queued task to the right agent, the agent turns green and types while it works, and the result appears under the task in the office. Results are also saved in `work/results/`.
- **Change a function.** *Change function* edits the desk label, department, avatar, the "use when" line and the full instructions. Saving writes the file in `agents/` and installs it into `~/.claude/agents`, so Claude Code uses the new version from its next session.

## Working hours

The clock is in the top right corner. The office is open 06:00 to 22:00. Outside those hours everyone sleeps at their desk, the lights are off, and `node office.mjs next` hands out no tasks, so nothing new starts. Tasks given at night wait for the morning.

Add `?time=23:30` to the address to preview how the office looks at another hour. This only changes the picture; the task queue always follows the real clock. The hours are `OPENS` and `CLOSES` at the top of `office.mjs` (and `isOpen` in `office.js` for the picture).

## The agent files

Each `agents/*.md` is a normal Claude Code agent with a few extra lines in its header that place it in the office:

| Key | Meaning |
|---|---|
| `job` | The label on the desk |
| `department` | Which floor it sits on; a new name opens a new floor |
| `floor` | Order of the floors, highest number on top |
| `desk` | Order of the desks on a floor, left to right |
| `color` | Colour of the outfit and the laptop light |
| `avatar` | `helper` or `claude` (the CEO) |
| `avatar_eyes` | `1` or `2` |
| `avatar_hair` | `spikes`, `tuft`, `parting`, `curl`, `bald` |
| `avatar_prop` | `clipboard`, `hardhat`, `pencil`, `check`, `magnifier`, `envelope`, `megaphone`, `none` |

Everything below the header is the agent's function: the instructions it works by.

To hire someone, add a new `.md` file with the same header. To let someone go, delete the file here and in `~/.claude/agents`.

## Commands

| Command | What it does |
|---|---|
| `node office.mjs` | Opens the office |
| `node office.mjs build` | Regenerates `data.js` after editing agent files by hand |
| `node office.mjs sync` | Installs every agent and the `run-agency` skill into `~/.claude` |
| `node office.mjs queue` | Lists the tasks |
| `node office.mjs next` | Hands out the next queued task (used by `run-agency`) |
| `node office.mjs done <id>` | Marks a task finished once its result is in `work/results/<id>.md` |
| `node office.mjs fail <id> <reason>` | Marks a task failed |
