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
      sessions: {
        Row: {
          created_at: string
          cwd: string
          id: string
          model: string
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
      workspaces: {
        Row: {
          created_at: string
          cwd: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cwd: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cwd?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
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
