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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          password_hash: string
          role: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id?: string
          password_hash: string
          role?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          password_hash?: string
          role?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          entity: string | null
          entity_id: string | null
          id: string
          metadata: Json | null
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      ical_imported_events: {
        Row: {
          cancelled: boolean
          check_in: string
          check_out: string
          during: unknown
          id: string
          source_url: string | null
          synced_at: string
          uid: string
        }
        Insert: {
          cancelled?: boolean
          check_in: string
          check_out: string
          during?: unknown
          id?: string
          source_url?: string | null
          synced_at?: string
          uid: string
        }
        Update: {
          cancelled?: boolean
          check_in?: string
          check_out?: string
          during?: unknown
          id?: string
          source_url?: string | null
          synced_at?: string
          uid?: string
        }
        Relationships: []
      }
      ical_sync_logs: {
        Row: {
          duration_ms: number | null
          error_message: string | null
          events_found: number | null
          finished_at: string | null
          id: string
          periods_imported: number | null
          source_url: string | null
          started_at: string
          success: boolean | null
        }
        Insert: {
          duration_ms?: number | null
          error_message?: string | null
          events_found?: number | null
          finished_at?: string | null
          id?: string
          periods_imported?: number | null
          source_url?: string | null
          started_at?: string
          success?: boolean | null
        }
        Update: {
          duration_ms?: number | null
          error_message?: string | null
          events_found?: number | null
          finished_at?: string | null
          id?: string
          periods_imported?: number | null
          source_url?: string | null
          started_at?: string
          success?: boolean | null
        }
        Relationships: []
      }
      manual_blocks: {
        Row: {
          active: boolean
          check_in: string
          check_out: string
          created_at: string
          created_by: string | null
          during: unknown
          id: string
          reason: string | null
        }
        Insert: {
          active?: boolean
          check_in: string
          check_out: string
          created_at?: string
          created_by?: string | null
          during?: unknown
          id?: string
          reason?: string | null
        }
        Update: {
          active?: boolean
          check_in?: string
          check_out?: string
          created_at?: string
          created_by?: string | null
          during?: unknown
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      notification_logs: {
        Row: {
          channel: string
          created_at: string
          error_message: string | null
          id: string
          recipient: string | null
          reservation_id: string | null
          status: string
          template: string
        }
        Insert: {
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          recipient?: string | null
          reservation_id?: string | null
          status?: string
          template: string
        }
        Update: {
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          recipient?: string | null
          reservation_id?: string | null
          status?: string
          template?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount_cents: number | null
          created_at: string
          currency: string | null
          external_reference: string | null
          id: string
          live_mode: boolean | null
          payment_id: string | null
          preference_id: string | null
          provider: string
          raw: Json | null
          reservation_id: string
          status: string | null
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          external_reference?: string | null
          id?: string
          live_mode?: boolean | null
          payment_id?: string | null
          preference_id?: string | null
          provider?: string
          raw?: Json | null
          reservation_id: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          external_reference?: string | null
          id?: string
          live_mode?: boolean | null
          payment_id?: string | null
          preference_id?: string | null
          provider?: string
          raw?: Json | null
          reservation_id?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_webhook_events: {
        Row: {
          event_key: string
          id: string
          payload: Json | null
          processed: boolean
          provider: string
          received_at: string
          signature_ok: boolean
        }
        Insert: {
          event_key: string
          id?: string
          payload?: Json | null
          processed?: boolean
          provider?: string
          received_at?: string
          signature_ok: boolean
        }
        Update: {
          event_key?: string
          id?: string
          payload?: Json | null
          processed?: boolean
          provider?: string
          received_at?: string
          signature_ok?: boolean
        }
        Relationships: []
      }
      pricing_rules: {
        Row: {
          charge_deposit_upfront: boolean
          cleaning_fee_cents: number
          default_nightly_cents: number
          extra_guest_fee_cents: number
          extra_guest_per: string
          flat_discount_percent: number
          id: string
          included_guests: number
          is_active: boolean
          length_of_stay_discounts: Json
          max_guests: number
          max_installments: number
          max_nights: number | null
          min_nights: number
          min_reservation_cents: number
          payment_expiration_hours: number
          payment_mode: string
          prep_buffer_nights: number
          security_deposit_cents: number
          signal_percent: number
          updated_at: string
          weekday_nightly_cents: Json
        }
        Insert: {
          charge_deposit_upfront?: boolean
          cleaning_fee_cents?: number
          default_nightly_cents: number
          extra_guest_fee_cents?: number
          extra_guest_per?: string
          flat_discount_percent?: number
          id?: string
          included_guests?: number
          is_active?: boolean
          length_of_stay_discounts?: Json
          max_guests?: number
          max_installments?: number
          max_nights?: number | null
          min_nights?: number
          min_reservation_cents?: number
          payment_expiration_hours?: number
          payment_mode?: string
          prep_buffer_nights?: number
          security_deposit_cents?: number
          signal_percent?: number
          updated_at?: string
          weekday_nightly_cents?: Json
        }
        Update: {
          charge_deposit_upfront?: boolean
          cleaning_fee_cents?: number
          default_nightly_cents?: number
          extra_guest_fee_cents?: number
          extra_guest_per?: string
          flat_discount_percent?: number
          id?: string
          included_guests?: number
          is_active?: boolean
          length_of_stay_discounts?: Json
          max_guests?: number
          max_installments?: number
          max_nights?: number | null
          min_nights?: number
          min_reservation_cents?: number
          payment_expiration_hours?: number
          payment_mode?: string
          prep_buffer_nights?: number
          security_deposit_cents?: number
          signal_percent?: number
          updated_at?: string
          weekday_nightly_cents?: Json
        }
        Relationships: []
      }
      reservation_guests: {
        Row: {
          accepted_at: string | null
          accepted_cancellation: boolean
          accepted_privacy: boolean
          accepted_rules: boolean
          created_at: string
          document: string | null
          email: string
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          reservation_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_cancellation?: boolean
          accepted_privacy?: boolean
          accepted_rules?: boolean
          created_at?: string
          document?: string | null
          email: string
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          reservation_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_cancellation?: boolean
          accepted_privacy?: boolean
          accepted_rules?: boolean
          created_at?: string
          document?: string | null
          email?: string
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          reservation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_guests_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_status_history: {
        Row: {
          admin_user: string | null
          created_at: string
          external_event: string | null
          from_status: Database["public"]["Enums"]["reservation_status"] | null
          id: string
          note: string | null
          origin: string
          reservation_id: string
          technical_id: string
          to_status: Database["public"]["Enums"]["reservation_status"]
        }
        Insert: {
          admin_user?: string | null
          created_at?: string
          external_event?: string | null
          from_status?: Database["public"]["Enums"]["reservation_status"] | null
          id?: string
          note?: string | null
          origin: string
          reservation_id: string
          technical_id: string
          to_status: Database["public"]["Enums"]["reservation_status"]
        }
        Update: {
          admin_user?: string | null
          created_at?: string
          external_event?: string | null
          from_status?: Database["public"]["Enums"]["reservation_status"] | null
          id?: string
          note?: string | null
          origin?: string
          reservation_id?: string
          technical_id?: string
          to_status?: Database["public"]["Enums"]["reservation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "reservation_status_history_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          adults: number
          approved_at: string | null
          check_in: string
          check_out: string
          children: number
          confirmed_at: string | null
          created_at: string
          currency: string
          during: unknown
          external_reference: string
          friendly_code: string
          id: string
          pay_now_cents: number
          payment_expires_at: string | null
          public_token: string
          quote: Json
          status: Database["public"]["Enums"]["reservation_status"]
          total_cents: number
          updated_at: string
        }
        Insert: {
          adults: number
          approved_at?: string | null
          check_in: string
          check_out: string
          children?: number
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          during?: unknown
          external_reference: string
          friendly_code: string
          id?: string
          pay_now_cents: number
          payment_expires_at?: string | null
          public_token: string
          quote: Json
          status?: Database["public"]["Enums"]["reservation_status"]
          total_cents: number
          updated_at?: string
        }
        Update: {
          adults?: number
          approved_at?: string | null
          check_in?: string
          check_out?: string
          children?: number
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          during?: unknown
          external_reference?: string
          friendly_code?: string
          id?: string
          pay_now_cents?: number
          payment_expires_at?: string | null
          public_token?: string
          quote?: Json
          status?: Database["public"]["Enums"]["reservation_status"]
          total_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      special_periods: {
        Row: {
          created_at: string
          discount_percent: number | null
          end_date: string
          id: string
          min_nights: number | null
          name: string
          nightly_cents: number | null
          start_date: string
        }
        Insert: {
          created_at?: string
          discount_percent?: number | null
          end_date: string
          id?: string
          min_nights?: number | null
          name: string
          nightly_cents?: number | null
          start_date: string
        }
        Update: {
          created_at?: string
          discount_percent?: number | null
          end_date?: string
          id?: string
          min_nights?: number | null
          name?: string
          nightly_cents?: number | null
          start_date?: string
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
      block_source: "reservation" | "manual_block" | "ical_airbnb"
      reservation_status:
        | "pending_approval"
        | "rejected"
        | "awaiting_payment"
        | "payment_pending"
        | "paid"
        | "confirmed"
        | "cancelled"
        | "refunded"
        | "expired"
        | "completed"
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
    Enums: {
      block_source: ["reservation", "manual_block", "ical_airbnb"],
      reservation_status: [
        "pending_approval",
        "rejected",
        "awaiting_payment",
        "payment_pending",
        "paid",
        "confirmed",
        "cancelled",
        "refunded",
        "expired",
        "completed",
      ],
    },
  },
} as const
