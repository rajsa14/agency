---
name: run-agency
description: Carries out tasks from Richard's agency office (C:\Users\TIGO\claude\agency) with Claude Code agents instead of the Anthropic API. Use when he says "run the agency", "run the office", "do the queued tasks", "let the agents work", or invokes /run-agency.
---

# Run the agency

The office normally runs tasks itself through the Anthropic API. This skill is the other way to get them done: you hand each waiting task to the matching Claude Code agent. It works on the local office only (the database in `work/agency.db`), not on the deployed one.

All commands run from `C:\Users\TIGO\claude\agency`.

1. Take a task:

   ```bash
   node office.mjs next
   ```

   It prints JSON. `{"none": true}` means nothing is ready: report what was done and stop. `{"closed": true}` means it is between 22:00 and 06:00, when nobody works: say so and stop, and do not work around it. Otherwise you get `id`, `agent`, `task`, `result` and `files`, and the task now shows as running in the office. Tasks that wait for another task's approval are not handed out.

2. Start that agent with the Agent tool: `subagent_type` is the `agent` value exactly as printed, and the prompt is the `task` text followed by this line: "Save any files you produce under <files>. End with the finished result written out in full." The agent starts with no context, so pass the task unchanged and add nothing of your own.

3. Write the agent's final report, unchanged, to the `result` path, then:

   ```bash
   node office.mjs done <id>
   ```

   The result then waits in the office for Richard's approval. If the agent could not do the task, record why instead:

   ```bash
   node office.mjs fail <id> <short reason>
   ```

4. Go back to step 1. You may take up to three tasks at once and run their agents in parallel; `next` never hands out two tasks for the same agent at the same time.

Rules:
- Run `next` again before every task, so nothing new starts after 22:00.
- Do not do an agent's task yourself and do not edit its result.
- Do not approve results. Approving is Richard's step, in the office.
- Anything an agent drafted for the outside world (a message, a post, a price) stays a draft. Nothing is sent, published or deployed from here.
- Finish with a short list: task, agent, done or failed.
