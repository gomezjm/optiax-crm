export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      agent_configs: {
        Row: {
          config: Json
          created_at: string
          id: string
          status: Database["public"]["Enums"]["e_config_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          config: Json
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["e_config_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["e_config_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_turns: {
        Row: {
          conversation_id: string
          created_at: string
          error: Json | null
          id: string
          input_tokens: number
          latency_ms: number
          message_id: string | null
          model: string
          output_tokens: number
          prompt_version_id: string
          tenant_id: string
          tool_calls: Json
        }
        Insert: {
          conversation_id: string
          created_at?: string
          error?: Json | null
          id?: string
          input_tokens: number
          latency_ms: number
          message_id?: string | null
          model: string
          output_tokens: number
          prompt_version_id: string
          tenant_id: string
          tool_calls?: Json
        }
        Update: {
          conversation_id?: string
          created_at?: string
          error?: Json | null
          id?: string
          input_tokens?: number
          latency_ms?: number
          message_id?: string | null
          model?: string
          output_tokens?: number
          prompt_version_id?: string
          tenant_id?: string
          tool_calls?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_turns_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_turns_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_turns_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_turns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      attribute_defs: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          is_preset: boolean
          key: string
          label: string
          options: Json | null
          tenant_id: string
          type: Database["public"]["Enums"]["e_attr_type"]
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_preset?: boolean
          key: string
          label: string
          options?: Json | null
          tenant_id: string
          type: Database["public"]["Enums"]["e_attr_type"]
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_preset?: boolean
          key?: string
          label?: string
          options?: Json | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["e_attr_type"]
        }
        Relationships: [
          {
            foreignKeyName: "attribute_defs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_reply_rules: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          response: string
          tenant_id: string
          trigger: Json
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          response: string
          tenant_id: string
          trigger: Json
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          response?: string
          tenant_id?: string
          trigger?: Json
        }
        Relationships: [
          {
            foreignKeyName: "auto_reply_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          name: string
          read_count: number
          segment_id: string
          sent_count: number
          starts_at: string | null
          status: Database["public"]["Enums"]["e_campaign_status"]
          template_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          name: string
          read_count?: number
          segment_id: string
          sent_count?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["e_campaign_status"]
          template_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          name?: string
          read_count?: number
          segment_id?: string
          sent_count?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["e_campaign_status"]
          template_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "wa_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          bot_paused: boolean
          created_at: string
          customer_id: string | null
          id: string
          last_customer_message_at: string | null
          last_message_at: string | null
          needs_attention: boolean
          paused_until: string | null
          tenant_id: string
          updated_at: string
          wa_id: string
        }
        Insert: {
          bot_paused?: boolean
          created_at?: string
          customer_id?: string | null
          id?: string
          last_customer_message_at?: string | null
          last_message_at?: string | null
          needs_attention?: boolean
          paused_until?: string | null
          tenant_id: string
          updated_at?: string
          wa_id: string
        }
        Update: {
          bot_paused?: boolean
          created_at?: string
          customer_id?: string | null
          id?: string
          last_customer_message_at?: string | null
          last_message_at?: string | null
          needs_attention?: boolean
          paused_until?: string | null
          tenant_id?: string
          updated_at?: string
          wa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tags: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          tag_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          tag_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          tag_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tags_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          age_group: string | null
          attributes: Json
          city: string | null
          consent_status: Database["public"]["Enums"]["e_consent"]
          created_at: string
          email: string | null
          gender: string | null
          id: string
          last_message_at: string | null
          last_order_at: string | null
          name: string | null
          phone: string | null
          source: Database["public"]["Enums"]["e_customer_source"]
          tenant_id: string
          total_spent: number
          updated_at: string
          wa_id: string | null
        }
        Insert: {
          address?: string | null
          age_group?: string | null
          attributes?: Json
          city?: string | null
          consent_status?: Database["public"]["Enums"]["e_consent"]
          created_at?: string
          email?: string | null
          gender?: string | null
          id?: string
          last_message_at?: string | null
          last_order_at?: string | null
          name?: string | null
          phone?: string | null
          source: Database["public"]["Enums"]["e_customer_source"]
          tenant_id: string
          total_spent?: number
          updated_at?: string
          wa_id?: string | null
        }
        Update: {
          address?: string | null
          age_group?: string | null
          attributes?: Json
          city?: string | null
          consent_status?: Database["public"]["Enums"]["e_consent"]
          created_at?: string
          email?: string | null
          gender?: string | null
          id?: string
          last_message_at?: string | null
          last_order_at?: string | null
          name?: string | null
          phone?: string | null
          source?: Database["public"]["Enums"]["e_customer_source"]
          tenant_id?: string
          total_spent?: number
          updated_at?: string
          wa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          campaign_id: string | null
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["e_direction"]
          error: Json | null
          id: string
          media_path: string | null
          source: Database["public"]["Enums"]["e_msg_source"]
          template_name: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["e_msg_type"]
          wa_message_id: string | null
          wa_status: Database["public"]["Enums"]["e_wa_status"] | null
        }
        Insert: {
          body?: string | null
          campaign_id?: string | null
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["e_direction"]
          error?: Json | null
          id?: string
          media_path?: string | null
          source: Database["public"]["Enums"]["e_msg_source"]
          template_name?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["e_msg_type"]
          wa_message_id?: string | null
          wa_status?: Database["public"]["Enums"]["e_wa_status"] | null
        }
        Update: {
          body?: string | null
          campaign_id?: string | null
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["e_direction"]
          error?: Json | null
          id?: string
          media_path?: string | null
          source?: Database["public"]["Enums"]["e_msg_source"]
          template_name?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["e_msg_type"]
          wa_message_id?: string | null
          wa_status?: Database["public"]["Enums"]["e_wa_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          description: string
          id: string
          order_id: string
          product_id: string | null
          qty: number
          tenant_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          order_id: string
          product_id?: string | null
          qty: number
          tenant_id: string
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          order_id?: string
          product_id?: string | null
          qty?: number
          tenant_id?: string
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
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_statuses: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["e_status_kind"]
          name: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["e_status_kind"]
          name: string
          sort_order: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["e_status_kind"]
          name?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_statuses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          campaign_id: string | null
          conversation_id: string | null
          created_at: string
          currency: string
          customer_id: string
          delivery_address: string | null
          delivery_date: string | null
          driver_notes: string | null
          id: string
          payment_method_id: string | null
          payment_proof_media_path: string | null
          payment_reference: string | null
          payment_verified_at: string | null
          source: Database["public"]["Enums"]["e_order_source"]
          status_id: string
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          conversation_id?: string | null
          created_at?: string
          currency: string
          customer_id: string
          delivery_address?: string | null
          delivery_date?: string | null
          driver_notes?: string | null
          id?: string
          payment_method_id?: string | null
          payment_proof_media_path?: string | null
          payment_reference?: string | null
          payment_verified_at?: string | null
          source: Database["public"]["Enums"]["e_order_source"]
          status_id: string
          tenant_id: string
          total: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          conversation_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          delivery_address?: string | null
          delivery_date?: string | null
          driver_notes?: string | null
          id?: string
          payment_method_id?: string | null
          payment_proof_media_path?: string | null
          payment_reference?: string | null
          payment_verified_at?: string | null
          source?: Database["public"]["Enums"]["e_order_source"]
          status_id?: string
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "order_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          created_at: string
          details: string
          enabled: boolean
          id: string
          label: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          details: string
          enabled?: boolean
          id?: string
          label: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          details?: string
          enabled?: boolean
          id?: string
          label?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          available: boolean
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          image_paths: string[]
          name: string
          price: number
          promo_price: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          available?: boolean
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_paths?: string[]
          name: string
          price: number
          promo_price?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          available?: boolean
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_paths?: string[]
          name?: string
          price?: number
          promo_price?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          role: Database["public"]["Enums"]["e_role"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          role?: Database["public"]["Enums"]["e_role"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          role?: Database["public"]["Enums"]["e_role"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          compiled_prompt: string
          compiler_version: string
          config_snapshot: Json
          created_at: string
          id: string
          tenant_id: string
          vertical: string
        }
        Insert: {
          compiled_prompt: string
          compiler_version: string
          config_snapshot: Json
          created_at?: string
          id?: string
          tenant_id: string
          vertical: string
        }
        Update: {
          compiled_prompt?: string
          compiler_version?: string
          config_snapshot?: Json
          created_at?: string
          id?: string
          tenant_id?: string
          vertical?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      segments: {
        Row: {
          created_at: string
          id: string
          is_template: boolean
          name: string
          rules: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_template?: boolean
          name: string
          rules: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_template?: boolean
          name?: string
          rules?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "segments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          color: string
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          active_prompt_version_id: string | null
          agent_enabled: boolean
          created_at: string
          currency: string
          id: string
          locale: string
          name: string
          plan: string
          timezone: string
          updated_at: string
          vertical: string
          wa_channel_id: string | null
          wa_channel_status: Database["public"]["Enums"]["e_channel_status"]
          wa_phone_number_id: string | null
        }
        Insert: {
          active_prompt_version_id?: string | null
          agent_enabled?: boolean
          created_at?: string
          currency?: string
          id?: string
          locale?: string
          name: string
          plan?: string
          timezone?: string
          updated_at?: string
          vertical: string
          wa_channel_id?: string | null
          wa_channel_status?: Database["public"]["Enums"]["e_channel_status"]
          wa_phone_number_id?: string | null
        }
        Update: {
          active_prompt_version_id?: string | null
          agent_enabled?: boolean
          created_at?: string
          currency?: string
          id?: string
          locale?: string
          name?: string
          plan?: string
          timezone?: string
          updated_at?: string
          vertical?: string
          wa_channel_id?: string | null
          wa_channel_status?: Database["public"]["Enums"]["e_channel_status"]
          wa_phone_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenants_active_prompt_version_id_fkey"
            columns: ["active_prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_templates: {
        Row: {
          body: string
          category: string
          created_at: string
          id: string
          language: string
          meta_status: Database["public"]["Enums"]["e_template_status"]
          meta_template_id: string | null
          name: string
          tenant_id: string
          updated_at: string
          variables: Json
        }
        Insert: {
          body: string
          category: string
          created_at?: string
          id?: string
          language?: string
          meta_status?: Database["public"]["Enums"]["e_template_status"]
          meta_template_id?: string | null
          name: string
          tenant_id: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          id?: string
          language?: string
          meta_status?: Database["public"]["Enums"]["e_template_status"]
          meta_template_id?: string | null
          name?: string
          tenant_id?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "wa_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          error: Json | null
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          provider: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          error?: Json | null
          event_type: string
          id?: string
          payload: Json
          processed_at?: string | null
          provider?: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          error?: Json | null
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      e_attr_type: "text" | "number" | "date" | "select" | "boolean"
      e_campaign_status:
        | "draft"
        | "scheduled"
        | "running"
        | "done"
        | "cancelled"
      e_channel_status: "disconnected" | "pending" | "live"
      e_config_status: "draft" | "published"
      e_consent: "unknown" | "opted_in" | "opted_out"
      e_customer_source: "agent" | "manual" | "import" | "coexistence_sync"
      e_direction: "inbound" | "outbound"
      e_msg_source:
        | "customer"
        | "bot"
        | "owner_app"
        | "dashboard"
        | "campaign"
        | "system"
      e_msg_type:
        | "text"
        | "image"
        | "audio"
        | "video"
        | "document"
        | "template"
        | "other"
      e_order_source: "agent" | "manual"
      e_role: "admin" | "sales_rep"
      e_status_kind:
        | "new"
        | "awaiting_payment"
        | "awaiting_verification"
        | "processing"
        | "shipped"
        | "delivered"
        | "cancelled"
      e_template_status: "draft" | "submitted" | "approved" | "rejected"
      e_wa_status: "accepted" | "sent" | "delivered" | "read" | "failed"
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
      e_attr_type: ["text", "number", "date", "select", "boolean"],
      e_campaign_status: ["draft", "scheduled", "running", "done", "cancelled"],
      e_channel_status: ["disconnected", "pending", "live"],
      e_config_status: ["draft", "published"],
      e_consent: ["unknown", "opted_in", "opted_out"],
      e_customer_source: ["agent", "manual", "import", "coexistence_sync"],
      e_direction: ["inbound", "outbound"],
      e_msg_source: [
        "customer",
        "bot",
        "owner_app",
        "dashboard",
        "campaign",
        "system",
      ],
      e_msg_type: [
        "text",
        "image",
        "audio",
        "video",
        "document",
        "template",
        "other",
      ],
      e_order_source: ["agent", "manual"],
      e_role: ["admin", "sales_rep"],
      e_status_kind: [
        "new",
        "awaiting_payment",
        "awaiting_verification",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ],
      e_template_status: ["draft", "submitted", "approved", "rejected"],
      e_wa_status: ["accepted", "sent", "delivered", "read", "failed"],
    },
  },
} as const

