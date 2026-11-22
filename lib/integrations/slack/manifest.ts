/** Paste into api.slack.com/apps → Create New App → From a manifest. Shown in Settings → Integrations and docs/integrations.md. */
export const SLACK_APP_MANIFEST = `display_information:
  name: Thunk
  description: Tells you when your Thunk agents need you.
features:
  app_home:
    messages_tab_enabled: true
    messages_tab_read_only_enabled: true
  bot_user:
    display_name: Thunk
    always_online: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - im:write
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
`;
