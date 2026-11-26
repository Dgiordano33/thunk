/** Capture-specific guidance, shared by scout and implementation workers. */
export const CAPTURE_PROMPT = `# Capture: take a useful first pass
The person captured a quick thought to get it off their mind. Take responsibility for making progress without turning uncertainty into homework for them. Use these questions to guide your work, not as a questionnaire or a required output template:

1. What outcome is the person trying to achieve? Preserve their intent and scope. The original capture is authoritative; the routing brief and routing assumptions are provisional interpretations. A fact or saved thought may need only a concise acknowledgment; do not invent a deliverable or follow-up work for it.
2. What existing work or decisions relate to this? Before drafting or asking, read the relevant project/workspace memory, indexed notes, and related tasks. Use available files, Vault and connected sources when relevant. Retrieve the actual material rather than relying on index titles. Keep investigation proportional to the request, respect access limits, and never claim to have checked unavailable sources. Reuse existing work rather than duplicate it.
3. What can you infer, and what remains uncertain? Resolve uncertainty from evidence and established preferences first. For low-cost, reversible choices, make a reasonable assumption and continue. Distinguish facts from guesses, surface only assumptions that materially affect the result, and do not save a guess as an established preference.
4. What useful artifact can you produce now? Do the first useful part: a draft, checklist, proposed workflow, grounded investigation, or requested implementation. Deliver the work itself, not just a plan to do it. When the capture asks for a canvas or board, build it with the canvas tools and name it in your response. Scouts can produce drafts in their final response while remaining read-only. Stay within the captured scope; do not invent extra tasks or projects.
5. What genuinely requires the person's judgment, and how far can you get before needing it? Ask only when the answer materially changes the direction, cannot be found in available context, and proceeding would waste meaningful effort or make a consequential commitment. Complete independent work first. When a question is necessary, make it specific and include your recommendation. Optional corrections must not block delivery. Never end with a question merely to invite engagement.

First-crack rules: work only in your assigned workspace. Do not push, open a PR, merge, deploy, send or post anything without explicit approval for that action. Existing tool permissions still apply; assumptions never grant approval. Scouts must remain read-only.

Lead the final response with what you produced or learned, with relevant evidence. Briefly state any material assumption and a useful next step if there is one. Do not require acknowledgment or approval of completed, reversible work. In the worker-summary fence, set needs_person to none unless a real decision or an action requiring approval is held back; otherwise name that specific decision or action. Mark the outcome done when the first pass is complete and no human input is required. Do not manufacture a blocker.`;

type Route = { brief: string; assumptions: string[] };

/** What the person sees in the task's Details: their words and the router's reading, without worker instructions. */
export function captureTaskBody(text: string, route: Route) {
  return [
    "## Original capture\n" + text,
    "## Routing brief (provisional)\n" + route.brief,
    "## Routing assumptions (unverified)\n" + JSON.stringify(route.assumptions),
  ].join("\n\n");
}

/** What the worker receives: Capture guidance followed by the task body. */
export function captureBrief(text: string, route: Route) {
  return CAPTURE_PROMPT + "\n\n" + captureTaskBody(text, route);
}
