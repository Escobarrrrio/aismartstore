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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          city: string
          country: string
          created_at: string
          id: string
          is_default: boolean
          label: string
          line1: string
          line2: string | null
          phone: string | null
          postal_code: string | null
          province: string | null
          recipient_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          city: string
          country?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          line1: string
          line2?: string | null
          phone?: string | null
          postal_code?: string | null
          province?: string | null
          recipient_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string
          country?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          line1?: string
          line2?: string | null
          phone?: string | null
          postal_code?: string | null
          province?: string | null
          recipient_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          messages: Json
          session_id: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          messages?: Json
          session_id: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          messages?: Json
          session_id?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ai_pulse_items: {
        Row: {
          category: string
          created_at: string
          id: string
          image_url: string | null
          published_at: string | null
          source: string
          summary: string | null
          title: string
          url: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          image_url?: string | null
          published_at?: string | null
          source: string
          summary?: string | null
          title: string
          url: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          image_url?: string | null
          published_at?: string | null
          source?: string
          summary?: string | null
          title?: string
          url?: string
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          completion_tokens: number | null
          created_at: string
          estimated_cost_usd: number | null
          id: string
          model: string
          prompt_tokens: number | null
          provider: string
          source: string
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          completion_tokens?: number | null
          created_at?: string
          estimated_cost_usd?: number | null
          id?: string
          model: string
          prompt_tokens?: number | null
          provider: string
          source: string
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number | null
          created_at?: string
          estimated_cost_usd?: number | null
          id?: string
          model?: string
          prompt_tokens?: number | null
          provider?: string
          source?: string
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      automation_events: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          payload: Json | null
          response: Json | null
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          payload?: Json | null
          response?: Json | null
          source?: string
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          payload?: Json | null
          response?: Json | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      brands: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_category_id: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_category_id?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_category_id?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_category_id_fkey"
            columns: ["parent_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_access_log: {
        Row: {
          actor_id: string | null
          created_at: string
          email: string | null
          event_type: string
          id: string
          ip_address: string | null
          metadata: Json
          quote_request_id: string | null
          user_agent: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          email?: string | null
          event_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          quote_request_id?: string | null
          user_agent?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          email?: string | null
          event_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          quote_request_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      compliance_documents: {
        Row: {
          account_manager_email: string | null
          account_manager_name: string | null
          account_manager_phone: string | null
          bank_account_number: string | null
          bank_branch_code: string | null
          bank_name: string | null
          bbbee_certificate_url: string | null
          bbbee_level: string | null
          cipc_registration_number: string | null
          created_at: string
          csd_supplier_number: string | null
          entity_legal_name: string
          id: string
          notes: string | null
          tax_reference_number: string | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          account_manager_email?: string | null
          account_manager_name?: string | null
          account_manager_phone?: string | null
          bank_account_number?: string | null
          bank_branch_code?: string | null
          bank_name?: string | null
          bbbee_certificate_url?: string | null
          bbbee_level?: string | null
          cipc_registration_number?: string | null
          created_at?: string
          csd_supplier_number?: string | null
          entity_legal_name: string
          id?: string
          notes?: string | null
          tax_reference_number?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          account_manager_email?: string | null
          account_manager_name?: string | null
          account_manager_phone?: string | null
          bank_account_number?: string | null
          bank_branch_code?: string | null
          bank_name?: string | null
          bbbee_certificate_url?: string | null
          bbbee_level?: string | null
          cipc_registration_number?: string | null
          created_at?: string
          csd_supplier_number?: string | null
          entity_legal_name?: string
          id?: string
          notes?: string | null
          tax_reference_number?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      exchange_rates: {
        Row: {
          currency_code: string
          rate_to_zar: number
          updated_at: string
        }
        Insert: {
          currency_code: string
          rate_to_zar: number
          updated_at?: string
        }
        Update: {
          currency_code?: string
          rate_to_zar?: number
          updated_at?: string
        }
        Relationships: []
      }
      image_blocklist: {
        Row: {
          created_at: string
          reason: string | null
          url: string
        }
        Insert: {
          created_at?: string
          reason?: string | null
          url: string
        }
        Update: {
          created_at?: string
          reason?: string | null
          url?: string
        }
        Relationships: []
      }
      newsletter_campaigns: {
        Row: {
          body_html: string
          category_filter: string | null
          created_at: string
          id: string
          preview_text: string | null
          recipient_count: number | null
          sent_at: string | null
          status: string
          subject: string
        }
        Insert: {
          body_html: string
          category_filter?: string | null
          created_at?: string
          id?: string
          preview_text?: string | null
          recipient_count?: number | null
          sent_at?: string | null
          status?: string
          subject: string
        }
        Update: {
          body_html?: string
          category_filter?: string | null
          created_at?: string
          id?: string
          preview_text?: string | null
          recipient_count?: number | null
          sent_at?: string | null
          status?: string
          subject?: string
        }
        Relationships: []
      }
      newsletter_subscribers: {
        Row: {
          email: string
          id: string
          interested_categories: string[] | null
          name: string | null
          source: string
          subscribed_at: string
          unsubscribe_token: string
          unsubscribed_at: string | null
          user_id: string | null
        }
        Insert: {
          email: string
          id?: string
          interested_categories?: string[] | null
          name?: string | null
          source?: string
          subscribed_at?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          user_id?: string | null
        }
        Update: {
          email?: string
          id?: string
          interested_categories?: string[] | null
          name?: string | null
          source?: string
          subscribed_at?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          delivery_alerts: boolean
          order_updates: boolean
          promotional_emails: boolean
          sms_notifications: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          delivery_alerts?: boolean
          order_updates?: boolean
          promotional_emails?: boolean
          sms_notifications?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          delivery_alerts?: boolean
          order_updates?: boolean
          promotional_emails?: boolean
          sms_notifications?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          metadata: Json | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          metadata?: Json | null
          title: string
          type?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          metadata?: Json | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      order_audit_log: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          created_at: string
          event_type: string
          from_value: string | null
          id: string
          metadata: Json | null
          order_id: string
          to_value: string | null
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          event_type: string
          from_value?: string | null
          id?: string
          metadata?: Json | null
          order_id: string
          to_value?: string | null
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          event_type?: string
          from_value?: string | null
          id?: string
          metadata?: Json | null
          order_id?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_audit_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id: string
          quantity?: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address: string
          city: string
          created_at: string
          customer_email: string
          customer_name: string
          customer_phone: string
          id: string
          order_status: Database["public"]["Enums"]["order_status"] | null
          payment_id: string | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          postal_code: string
          province: string | null
          status: string
          total_amount: number
          tracking_number: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address: string
          city: string
          created_at?: string
          customer_email: string
          customer_name: string
          customer_phone: string
          id?: string
          order_status?: Database["public"]["Enums"]["order_status"] | null
          payment_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          postal_code: string
          province?: string | null
          status?: string
          total_amount: number
          tracking_number?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string
          city?: string
          created_at?: string
          customer_email?: string
          customer_name?: string
          customer_phone?: string
          id?: string
          order_status?: Database["public"]["Enums"]["order_status"] | null
          payment_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          postal_code?: string
          province?: string | null
          status?: string
          total_amount?: number
          tracking_number?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          amount_fee: number | null
          amount_gross: number | null
          amount_net: number | null
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          notified: boolean
          order_id: string | null
          outcome: string
          payment_status: string | null
          provider: string
          provider_payment_id: string | null
          raw_payload: Json | null
          sandbox: boolean
          signature_valid: boolean | null
          source_ip: string | null
        }
        Insert: {
          amount_fee?: number | null
          amount_gross?: number | null
          amount_net?: number | null
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          notified?: boolean
          order_id?: string | null
          outcome: string
          payment_status?: string | null
          provider?: string
          provider_payment_id?: string | null
          raw_payload?: Json | null
          sandbox?: boolean
          signature_valid?: boolean | null
          source_ip?: string | null
        }
        Update: {
          amount_fee?: number | null
          amount_gross?: number | null
          amount_net?: number | null
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          notified?: boolean
          order_id?: string | null
          outcome?: string
          payment_status?: string | null
          provider?: string
          provider_payment_id?: string | null
          raw_payload?: Json | null
          sandbox?: boolean
          signature_valid?: boolean | null
          source_ip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_costs: {
        Row: {
          axiz_product_id: string | null
          cost_price: number | null
          margin_percentage: number | null
          product_id: string
          selling_price: number | null
          updated_at: string
        }
        Insert: {
          axiz_product_id?: string | null
          cost_price?: number | null
          margin_percentage?: number | null
          product_id: string
          selling_price?: number | null
          updated_at?: string
        }
        Update: {
          axiz_product_id?: string | null
          cost_price?: number | null
          margin_percentage?: number | null
          product_id?: string
          selling_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_facets_cache: {
        Row: {
          facet_type: string
          facet_value: string
          product_count: number
          refreshed_at: string
        }
        Insert: {
          facet_type: string
          facet_value: string
          product_count: number
          refreshed_at?: string
        }
        Update: {
          facet_type?: string
          facet_value?: string
          product_count?: number
          refreshed_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          audience: string
          brand: string | null
          brand_id: string | null
          category: string | null
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          images: string[] | null
          in_stock: boolean
          is_active: boolean | null
          is_ai_product: boolean | null
          last_synced_at: string | null
          name: string
          price: number
          search_vector: unknown
          sku: string | null
          slug: string | null
          specifications: Json | null
          stock_quantity: number | null
          stock_status: Database["public"]["Enums"]["stock_status"] | null
          updated_at: string
        }
        Insert: {
          audience?: string
          brand?: string | null
          brand_id?: string | null
          category?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          images?: string[] | null
          in_stock?: boolean
          is_active?: boolean | null
          is_ai_product?: boolean | null
          last_synced_at?: string | null
          name: string
          price?: number
          search_vector?: unknown
          sku?: string | null
          slug?: string | null
          specifications?: Json | null
          stock_quantity?: number | null
          stock_status?: Database["public"]["Enums"]["stock_status"] | null
          updated_at?: string
        }
        Update: {
          audience?: string
          brand?: string | null
          brand_id?: string | null
          category?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          images?: string[] | null
          in_stock?: boolean
          is_active?: boolean | null
          is_ai_product?: boolean | null
          last_synced_at?: string | null
          name?: string
          price?: number
          search_vector?: unknown
          sku?: string | null
          slug?: string | null
          specifications?: Json | null
          stock_quantity?: number | null
          stock_status?: Database["public"]["Enums"]["stock_status"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_admin_notes: {
        Row: {
          created_at: string
          id: string
          notes: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          avatar_url: string | null
          city: string | null
          company_name: string | null
          country: string
          created_at: string
          customer_type: string
          email: string | null
          id: string
          id_number: string | null
          is_phone_verified: boolean
          last_login_at: string | null
          marketing_opt_in: boolean
          name: string | null
          phone: string | null
          postal_code: string | null
          preferred_language: string
          province: string | null
          updated_at: string
          user_id: string
          vat_number: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          city?: string | null
          company_name?: string | null
          country?: string
          created_at?: string
          customer_type?: string
          email?: string | null
          id?: string
          id_number?: string | null
          is_phone_verified?: boolean
          last_login_at?: string | null
          marketing_opt_in?: boolean
          name?: string | null
          phone?: string | null
          postal_code?: string | null
          preferred_language?: string
          province?: string | null
          updated_at?: string
          user_id: string
          vat_number?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          city?: string | null
          company_name?: string | null
          country?: string
          created_at?: string
          customer_type?: string
          email?: string | null
          id?: string
          id_number?: string | null
          is_phone_verified?: boolean
          last_login_at?: string | null
          marketing_opt_in?: boolean
          name?: string | null
          phone?: string | null
          postal_code?: string | null
          preferred_language?: string
          province?: string | null
          updated_at?: string
          user_id?: string
          vat_number?: string | null
        }
        Relationships: []
      }
      quote_requests: {
        Row: {
          admin_notes: string | null
          contact_name: string
          created_at: string
          email: string
          entity_type: string
          estimated_value: number | null
          id: string
          organisation_name: string
          phone: string | null
          requirements: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          contact_name: string
          created_at?: string
          email: string
          entity_type?: string
          estimated_value?: number | null
          id?: string
          organisation_name: string
          phone?: string | null
          requirements: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          contact_name?: string
          created_at?: string
          email?: string
          entity_type?: string
          estimated_value?: number | null
          id?: string
          organisation_name?: string
          phone?: string | null
          requirements?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      returns: {
        Row: {
          admin_notes: string | null
          created_at: string
          id: string
          order_id: string
          reason: string
          refund_amount: number | null
          status: Database["public"]["Enums"]["return_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          id?: string
          order_id: string
          reason?: string
          refund_amount?: number | null
          status?: Database["public"]["Enums"]["return_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          id?: string
          order_id?: string
          reason?: string
          refund_amount?: number | null
          status?: Database["public"]["Enums"]["return_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sms_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          phone: string
          purpose: string
          status: string
          telnyx_status_code: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          phone: string
          purpose?: string
          status: string
          telnyx_status_code?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          phone?: string
          purpose?: string
          status?: string
          telnyx_status_code?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      store_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          created_at: string
          id: string
          order_id: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          subject: string
          type: Database["public"]["Enums"]["ticket_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string
          type?: Database["public"]["Enums"]["ticket_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string
          type?: Database["public"]["Enums"]["ticket_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_details: string | null
          id: string
          items_failed: number | null
          items_synced: number | null
          source: string
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_details?: string | null
          id?: string
          items_failed?: number | null
          items_synced?: number | null
          source?: string
          started_at?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_details?: string | null
          id?: string
          items_failed?: number | null
          items_synced?: number | null
          source?: string
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      ticket_messages: {
        Row: {
          created_at: string
          id: string
          is_admin: boolean | null
          message: string
          sender_id: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_admin?: boolean | null
          message: string
          sender_id: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_admin?: boolean | null
          message?: string
          sender_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wishlists: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlists_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      backfill_audience_batch: {
        Args: { batch_size?: number; price_cap?: number }
        Returns: number
      }
      classify_product_category: {
        Args: { p_category?: string; p_name: string }
        Returns: string
      }
      deactivate_blocked_products_batch: {
        Args: { batch_size?: number }
        Returns: number
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_compliance_pack: {
        Args: { _email: string; _quote_id: string }
        Returns: {
          account_manager_email: string | null
          account_manager_name: string | null
          account_manager_phone: string | null
          bank_account_number: string | null
          bank_branch_code: string | null
          bank_name: string | null
          bbbee_certificate_url: string | null
          bbbee_level: string | null
          cipc_registration_number: string | null
          created_at: string
          csd_supplier_number: string | null
          entity_legal_name: string
          id: string
          notes: string | null
          tax_reference_number: string | null
          updated_at: string
          vat_number: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "compliance_documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_newsletter_subscriber_count: { Args: never; Returns: number }
      get_product_admin_view: {
        Args: never
        Returns: {
          axiz_product_id: string
          cost_price: number
          id: string
          margin_percentage: number
          selling_price: number
        }[]
      }
      get_product_facets:
        | {
            Args: never
            Returns: {
              facet_type: string
              facet_value: string
              product_count: number
            }[]
          }
        | {
            Args: { filter_audience?: string }
            Returns: {
              facet_type: string
              facet_value: string
              product_count: number
            }[]
          }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      quarantine_mispriced_products: {
        Args: { dry_run?: boolean }
        Returns: {
          brand: string
          category: string
          name: string
          price: number
          product_id: string
          reason: string
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recategorize_batch: { Args: { batch_size?: number }; Returns: number }
      record_payment_event: {
        Args: {
          p_amount_fee?: number
          p_amount_gross?: number
          p_amount_net?: number
          p_error?: string
          p_event_type: string
          p_order_id: string
          p_outcome: string
          p_payment_status: string
          p_provider: string
          p_provider_payment_id: string
          p_raw?: Json
          p_sandbox?: boolean
          p_signature_valid?: boolean
          p_source_ip?: string
        }
        Returns: {
          event_id: string
          is_first: boolean
        }[]
      }
      refresh_product_facets_cache: { Args: never; Returns: number }
      search_product_facets: {
        Args: {
          filter_ai_only?: boolean
          filter_audience?: string
          filter_brand?: string
          filter_category?: string
          filter_in_stock_only?: boolean
          max_price?: number
          min_price?: number
          search_query?: string
        }
        Returns: {
          facet_type: string
          facet_value: string
          product_count: number
        }[]
      }
      search_products:
        | {
            Args: {
              filter_ai_only?: boolean
              filter_brand?: string
              filter_category?: string
              filter_in_stock_only?: boolean
              max_price?: number
              min_price?: number
              page_number?: number
              page_size?: number
              search_query?: string
              sort_by?: string
            }
            Returns: {
              brand: string
              category: string
              description: string
              id: string
              images: string[]
              in_stock: boolean
              is_ai_product: boolean
              name: string
              price: number
              sku: string
              slug: string
              stock_quantity: number
              total_count: number
            }[]
          }
        | {
            Args: {
              filter_ai_only?: boolean
              filter_audience?: string
              filter_brand?: string
              filter_category?: string
              filter_in_stock_only?: boolean
              max_price?: number
              min_price?: number
              page_number?: number
              page_size?: number
              search_query?: string
              sort_by?: string
            }
            Returns: {
              audience: string
              brand: string
              category: string
              description: string
              id: string
              images: string[]
              in_stock: boolean
              is_ai_product: boolean
              name: string
              price: number
              sku: string
              slug: string
              stock_quantity: number
              total_count: number
            }[]
          }
      set_newsletter_interests: {
        Args: { _categories: string[]; _email: string; _subscriber_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "customer" | "admin"
      order_status: "pending" | "paid" | "shipped" | "delivered" | "returned"
      payment_status: "unpaid" | "paid" | "refunded" | "partially_refunded"
      return_status:
        | "requested"
        | "approved"
        | "received"
        | "refunded"
        | "rejected"
      stock_status: "in_stock" | "low_stock" | "out_of_stock"
      ticket_status: "open" | "pending" | "resolved"
      ticket_type: "return" | "refund" | "inquiry"
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
      app_role: ["customer", "admin"],
      order_status: ["pending", "paid", "shipped", "delivered", "returned"],
      payment_status: ["unpaid", "paid", "refunded", "partially_refunded"],
      return_status: [
        "requested",
        "approved",
        "received",
        "refunded",
        "rejected",
      ],
      stock_status: ["in_stock", "low_stock", "out_of_stock"],
      ticket_status: ["open", "pending", "resolved"],
      ticket_type: ["return", "refund", "inquiry"],
    },
  },
} as const
