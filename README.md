# Agency

The office of the WebTix agent team. Every agent is a file in `agents/`; the office shows who sits where and what each one does, and lets you change it.

## Open the office

```bash
node office.mjs
```

Then go to http://localhost:5190. Click a desk to read the agent's function. **Change function** edits the desk label, department, avatar, the "use when" line and the full instructions. Saving writes the file in `agents/` and installs it into `~/.claude/agents`, so Claude Code uses the new version from its next session.

Opening `index.html` directly works too, but only for looking: it shows the last built `data.js`.

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

```bash
node office.mjs build
```

Regenerates `data.js` after editing the files by hand.

```bash
node office.mjs sync
```

Installs every agent into `~/.claude/agents`, for example after pulling this repo on another computer.
