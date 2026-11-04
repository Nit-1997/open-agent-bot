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
      access_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          email: string
          id: string
          invite_error: string | null
          invite_status: string | null
          ip_hash: string
          name: string
          note: string
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          email: string
          id?: string
          invite_error?: string | null
          invite_status?: string | null
          ip_hash: string
          name: string
          note?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          email?: string
          id?: string
          invite_error?: string | null
          invite_status?: string | null
          ip_hash?: string
          name?: string
          note?: string
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      artifacts: {
        Row: {
          chat_id: string | null
          created_at: string
          html_path: string
          id: string
          pdf_path: string | null
          size_bytes: number
          thumb_path: string | null
          title: string
          user_id: string
        }
        Insert: {
          chat_id?: string | null
          created_at?: string
          html_path: string
          id: string
          pdf_path?: string | null
          size_bytes: number
          thumb_path?: string | null
          title: string
          user_id: string
        }
        Update: {
          chat_id?: string | null
          created_at?: string
          html_path?: string
          id?: string
          pdf_path?: string | null
          size_bytes?: number
          thumb_path?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_chat_id_user_id_fkey"
            columns: ["chat_id", "user_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      blocked_email_domains: {
        Row: {
          domain: string
        }
        Insert: {
          domain: string
        }
        Update: {
          domain?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: number
          parts: Json | null
          role: string
          run_id: string
          status: string
          user_id: string
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: never
          parts?: Json | null
          role: string
          run_id: string
          status?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: never
          parts?: Json | null
          role?: string
          run_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_id_user_id_fkey"
            columns: ["chat_id", "user_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      chats: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          model: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id: string
          last_message_at?: string
          model?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          model?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      human_checks: {
        Row: {
          checked_at: string
          user_id: string
        }
        Insert: {
          checked_at?: string
          user_id: string
        }
        Update: {
          checked_at?: string
          user_id?: string
        }
        Relationships: []
      }
      invited_emails: {
        Row: {
          created_at: string
          email: string
          invited_by: string | null
          request_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          invited_by?: string | null
          request_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          invited_by?: string | null
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invited_emails_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "access_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          data: Json
          email: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          email: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          email?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      provider_credentials: {
        Row: {
          ciphertext: string
          created_at: string
          dek_nonce: string
          dek_wrapped: string
          hint: string
          key_version: number
          kind: string
          nonce: string
          provider: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          ciphertext: string
          created_at?: string
          dek_nonce: string
          dek_wrapped: string
          hint: string
          key_version: number
          kind: string
          nonce: string
          provider: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          ciphertext?: string
          created_at?: string
          dek_nonce?: string
          dek_wrapped?: string
          hint?: string
          key_version?: number
          kind?: string
          nonce?: string
          provider?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      provider_settings: {
        Row: {
          data: Json
          device_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          data?: Json
          device_id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          data?: Json
          device_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      request_log: {
        Row: {
          at: string
          id: number
          user_id: string
        }
        Insert: {
          at: string
          id?: never
          user_id: string
        }
        Update: {
          at?: string
          id?: never
          user_id?: string
        }
        Relationships: []
      }
      request_usage: {
        Row: {
          count: number
          last_at: string | null
          month: string
          user_id: string
        }
        Insert: {
          count?: number
          last_at?: string | null
          month: string
          user_id: string
        }
        Update: {
          count?: number
          last_at?: string | null
          month?: string
          user_id?: string
        }
        Relationships: []
      }
      signup_settings: {
        Row: {
          id: boolean
          mode: string
          signups_per_day: number
          signups_per_hour: number
          signups_per_ip_day: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          mode?: string
          signups_per_day?: number
          signups_per_hour?: number
          signups_per_ip_day?: number
          updated_at?: string
        }
        Update: {
          id?: boolean
          mode?: string
          signups_per_day?: number
          signups_per_hour?: number
          signups_per_ip_day?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      access_request_submit: {
        Args: {
          p_email: string
          p_ip_hash: string
          p_name: string
          p_note: string
        }
        Returns: string
      }
      human_check_get: { Args: { p_user: string }; Returns: boolean }
      human_check_set: { Args: { p_user: string }; Returns: undefined }
      request_admit: {
        Args: {
          p_hour_cap: number
          p_month_cap: number
          p_now?: string
          p_user: string
        }
        Returns: {
          hour_used: number
          log_id: number
          month_used: number
          ok: boolean
          reason: string
          retry_at: string
        }[]
      }
      request_log_prune: { Args: { p_now?: string }; Returns: undefined }
      request_refund: {
        Args: { p_log_id: number; p_user: string }
        Returns: boolean
      }
      request_usage_get: {
        Args: { p_now?: string; p_user: string }
        Returns: {
          hour_retry_at: string
          hour_used: number
          month_used: number
        }[]
      }
      request_usage_page: {
        Args: {
          p_at_least: number
          p_limit: number
          p_now?: string
          p_offset: number
          p_query: string
        }
        Returns: Json
      }
      request_usage_summary: {
        Args: { p_now?: string }
        Returns: {
          active_users: number
          month_total: number
        }[]
      }
      search_user_content: {
        Args: {
          p_limit: number
          p_offset: number
          p_query: string
          p_scope: string
          p_user: string
        }
        Returns: Json
      }
      signup_settings_get: {
        Args: never
        Returns: {
          mode: string
          signups_per_day: number
          signups_per_hour: number
          signups_per_ip_day: number
        }[]
      }
      signup_stats: {
        Args: { p_now?: string }
        Returns: {
          cap_day: number
          cap_hour: number
          last_day: number
          last_hour: number
        }[]
      }
      usage_tombstone: {
        Args: { p_now?: string; p_user: string }
        Returns: boolean
      }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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

