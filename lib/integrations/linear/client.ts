// Linear's GraphQL API over fetch: the reads Thunk needs to mirror your issues as tasks. Pure, so tests pass a fake fetch.

export class LinearError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export type LinearIssue = {
  id: string; identifier: string; title: string; description: string | null; url: string; priority: number; updatedAt: string;
  state: { type: string }; assignee: { isMe: boolean } | null;
};
export type LinearTeam = { id: string; key: string; name: string };
/** What write-back needs to know about one issue: where it is, where it can go, and whether a PR is attached. */
export type LinearIssueState = { id: string; state: { type: string }; states: { id: string; type: string; position: number }[]; hasPullRequest: boolean };
export type LinearClient = {
  viewer(): Promise<{ name: string; organization: string }>;
  teams(): Promise<LinearTeam[]>;
  /** Open issues assigned to the key's owner in one team. */
  myOpenIssues(teamId: string): Promise<LinearIssue[]>;
  issuesByIds(ids: string[]): Promise<LinearIssue[]>;
  issueState(id: string): Promise<LinearIssueState | null>;
  moveIssue(id: string, stateId: string): Promise<void>;
};

const ISSUE = "id identifier title description url priority updatedAt state { type } assignee { isMe }";

export function linearClient(apiKey: string, fetchImpl: typeof fetch = fetch): LinearClient {
  const query = async <T>(q: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const response = await fetchImpl("https://api.linear.app/graphql", {
      method: "POST",
      // Personal API keys go in the header as-is; only OAuth tokens take "Bearer".
      headers: { authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify({ query: q, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 || response.status === 403) throw new LinearError("Linear rejected the API key. Create a new personal API key and paste it again.", response.status);
    if (response.status === 429) throw new LinearError("Linear is rate limiting Thunk. It will try again on the next sync.", 429);
    const data = (await response.json().catch(() => ({}))) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
    if (data.errors?.length) {
      const authFailed = data.errors.some((e) => e.extensions?.code === "AUTHENTICATION_ERROR");
      throw new LinearError(authFailed ? "Linear rejected the API key. Create a new personal API key and paste it again." : `Linear said: ${data.errors[0].message}`, response.status);
    }
    if (!response.ok || !data.data) throw new LinearError(`Linear request failed (${response.status})`, response.status);
    return data.data;
  };
  return {
    viewer: async () => {
      const d = await query<{ viewer: { name: string }; organization: { name: string } }>("{ viewer { name } organization { name } }");
      return { name: d.viewer.name, organization: d.organization.name };
    },
    teams: async () => (await query<{ teams: { nodes: LinearTeam[] } }>("{ teams(first: 100) { nodes { id key name } } }")).teams.nodes,
    myOpenIssues: async (teamId) => (await query<{ issues: { nodes: LinearIssue[] } }>(
      `query($teamId: ID!) { issues(first: 100, filter: { team: { id: { eq: $teamId } }, assignee: { isMe: { eq: true } }, state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${ISSUE} } } }`,
      { teamId })).issues.nodes,
    issuesByIds: async (ids) => ids.length ? (await query<{ issues: { nodes: LinearIssue[] } }>(
      `query($ids: [ID!]) { issues(first: 100, filter: { id: { in: $ids } }) { nodes { ${ISSUE} } } }`, { ids: ids.slice(0, 100) })).issues.nodes : [],
    issueState: async (id) => {
      type Raw = { issue: { id: string; state: { type: string }; team: { states: { nodes: { id: string; type: string; position: number }[] } }; attachments: { nodes: { url: string; sourceType: string | null }[] } } | null };
      const { issue } = await query<Raw>(
        "query($id: String!) { issue(id: $id) { id state { type } team { states(first: 50) { nodes { id type position } } } attachments(first: 50) { nodes { url sourceType } } } }", { id });
      if (!issue) return null;
      const hasPullRequest = issue.attachments.nodes.some((a) => /github|gitlab/i.test(a.sourceType ?? "") || /\/(pull|merge_requests)\/\d+/.test(a.url));
      return { id: issue.id, state: issue.state, states: issue.team.states.nodes, hasPullRequest };
    },
    moveIssue: async (id, stateId) => {
      const d = await query<{ issueUpdate: { success: boolean } }>("mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }", { id, stateId });
      if (!d.issueUpdate.success) throw new LinearError("Linear did not update the issue.");
    },
  };
}
