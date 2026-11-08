export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      comments: {
        Row: {
          anchor: Json | null
          author: string
          body: string
          created_at: string
          document_id: string
          id: string
          kind: string
          status: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          anchor?: Json | null
          author?: string
          body: string
          created_at?: string
          document_id: string
          id: string
          kind?: string
          status?: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          anchor?: Json | null
          author?: string
          body?: string
          created_at?: string
          document_id?: string
          id?: string
          kind?: string
          status?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_revisions: {
        Row: {
          diff: string | null
          document_id: string
          id: string
          payload: string
          sent_at: string
          stat: Json | null
        }
        Insert: {
          diff?: string | null
          document_id: string
          id?: string
          payload: string
          sent_at?: string
          stat?: Json | null
        }
        Update: {
          diff?: string | null
          document_id?: string
          id?: string
          payload?: string
          sent_at?: string
          stat?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "document_revisions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          baseline_markdown: string | null
          content_json: Json | null
          created_at: string
          current_markdown: string
          id: string
          kind: string
          message_id: string | null
          original_markdown: string
          parent_document_id: string | null
          session_id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          baseline_markdown?: string | null
          content_json?: Json | null
          created_at?: string
          current_markdown: string
          id: string
          kind?: string
          message_id?: string | null
          original_markdown: string
          parent_document_id?: string | null
          session_id: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          baseline_markdown?: string | null
          content_json?: Json | null
          created_at?: string
          current_markdown?: string
          id?: string
          kind?: string
          message_id?: string | null
          original_markdown?: string
          parent_document_id?: string | null
          session_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_parent_document_id_fkey"
            columns: ["parent_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content_json: Json
          created_at: string
          id: string
          markdown: string | null
          role: string
          seq: number
          session_id: string
          type: string
        }
        Insert: {
          content_json: Json
          created_at?: string
          id?: string
          markdown?: string | null
          role: string
          seq: number
          session_id: string
          type: string
        }
        Update: {
          content_json?: Json
          created_at?: string
          id?: string
          markdown?: string | null
          role?: string
          seq?: number
          session_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_runs: {
        Row: {
          cost_usd: number
          created_at: string
          diff_stat: Json | null
          error: string | null
          finished_at: string | null
          id: string
          note_id: string | null
          pr_url: string | null
          routine_id: string
          session_id: string | null
          started_at: string | null
          status: string
          summary: string | null
          trigger_payload: Json | null
          trigger_source: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          diff_stat?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          note_id?: string | null
          pr_url?: string | null
          routine_id: string
          session_id?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          trigger_payload?: Json | null
          trigger_source: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          cost_usd?: number
          created_at?: string
          diff_stat?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          note_id?: string | null
          pr_url?: string | null
          routine_id?: string
          session_id?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          trigger_payload?: Json | null
          trigger_source?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routine_runs_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_runs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      routines: {
        Row: {
          catch_up: string
          created_at: string
          enabled: boolean
          events: string[]
          id: string
          last_run_at: string | null
          max_run_minutes: number
          max_runs_per_day: number
          model: string
          name: string
          next_run_at: string | null
          permission_mode: string
          project_id: string
          prompt: string
          schedule_cron: string | null
          schedule_tz: string | null
          target_kind: string
          target_workspace_id: string | null
          trigger_state: Json
          updated_at: string
          webhook_token: string | null
        }
        Insert: {
          catch_up?: string
          created_at?: string
          enabled?: boolean
          events?: string[]
          id?: string
          last_run_at?: string | null
          max_run_minutes?: number
          max_runs_per_day?: number
          model: string
          name: string
          next_run_at?: string | null
          permission_mode?: string
          project_id: string
          prompt: string
          schedule_cron?: string | null
          schedule_tz?: string | null
          target_kind?: string
          target_workspace_id?: string | null
          trigger_state?: Json
          updated_at?: string
          webhook_token?: string | null
        }
        Update: {
          catch_up?: string
          created_at?: string
          enabled?: boolean
          events?: string[]
          id?: string
          last_run_at?: string | null
          max_run_minutes?: number
          max_runs_per_day?: number
          model?: string
          name?: string
          next_run_at?: string | null
          permission_mode?: string
          project_id?: string
          prompt?: string
          schedule_cron?: string | null
          schedule_tz?: string | null
          target_kind?: string
          target_workspace_id?: string | null
          trigger_state?: Json
          updated_at?: string
          webhook_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routines_target_workspace_id_fkey"
            columns: ["target_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          id: string
          project_id: string
          workspace_id: string | null
          title: string
          body: string | null
          status: string
          priority: number
          position: number
          created_by: string
          session_id: string | null
          created_in_session_id: string | null
          note_id: string | null
          due_at: string | null
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          workspace_id?: string | null
          title: string
          body?: string | null
          status?: string
          priority?: number
          position?: number
          created_by?: string
          session_id?: string | null
          created_in_session_id?: string | null
          note_id?: string | null
          due_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          workspace_id?: string | null
          title?: string
          body?: string | null
          status?: string
          priority?: number
          position?: number
          created_by?: string
          session_id?: string | null
          created_in_session_id?: string | null
          note_id?: string | null
          due_at?: string | null
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "tasks_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
          { foreignKeyName: "tasks_workspace_id_fkey"; columns: ["workspace_id"]; isOneToOne: false; referencedRelation: "workspaces"; referencedColumns: ["id"] },
          { foreignKeyName: "tasks_session_id_fkey"; columns: ["session_id"]; isOneToOne: false; referencedRelation: "sessions"; referencedColumns: ["id"] },
          { foreignKeyName: "tasks_created_in_session_id_fkey"; columns: ["created_in_session_id"]; isOneToOne: false; referencedRelation: "sessions"; referencedColumns: ["id"] },
        ]
      }
      sessions: {
        Row: {
          created_at: string
          cwd: string
          id: string
          model: string
          origin: Json | null
          permission_mode: string
          sdk_session_id: string | null
          status: string
          title: string | null
          total_cost_usd: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          cwd: string
          id: string
          model: string
          origin?: Json | null
          permission_mode: string
          sdk_session_id?: string | null
          status?: string
          title?: string | null
          total_cost_usd?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          cwd?: string
          id?: string
          model?: string
          origin?: Json | null
          permission_mode?: string
          sdk_session_id?: string | null
          status?: string
          title?: string | null
          total_cost_usd?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_calls: {
        Row: {
          approval: string | null
          created_at: string
          id: string
          input: Json | null
          is_error: boolean
          name: string
          output: string | null
          session_id: string
          status: string
          tool_use_id: string
          updated_at: string
        }
        Insert: {
          approval?: string | null
          created_at?: string
          id?: string
          input?: Json | null
          is_error?: boolean
          name: string
          output?: string | null
          session_id: string
          status?: string
          tool_use_id: string
          updated_at?: string
        }
        Update: {
          approval?: string | null
          created_at?: string
          id?: string
          input?: Json | null
          is_error?: boolean
          name?: string
          output?: string | null
          session_id?: string
          status?: string
          tool_use_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_calls_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          default_branch: string | null
          id: string
          kind: string
          name: string
          remote: string | null
          root: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_branch?: string | null
          id?: string
          kind?: string
          name: string
          remote?: string | null
          root: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_branch?: string | null
          id?: string
          kind?: string
          name?: string
          remote?: string | null
          root?: string
          updated_at?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          base_ref: string | null
          branch: string | null
          created_at: string
          cwd: string
          id: string
          name: string
          project_id: string
          slug: string
          status: string
          updated_at: string
          worktree_path: string | null
        }
        Insert: {
          base_ref?: string | null
          branch?: string | null
          created_at?: string
          cwd: string
          id?: string
          name: string
          project_id: string
          slug: string
          status?: string
          updated_at?: string
          worktree_path?: string | null
        }
        Update: {
          base_ref?: string | null
          branch?: string | null
          created_at?: string
          cwd?: string
          id?: string
          name?: string
          project_id?: string
          slug?: string
          status?: string
          updated_at?: string
          worktree_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
