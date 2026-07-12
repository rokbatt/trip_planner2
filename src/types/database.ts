/**
 * Supabase 타입 — 실제 스키마(schema.sql) 기준으로 수동 정리
 * (각 테이블에 Relationships 필드 필수 — 최신 @supabase/supabase-js 타입 요구사항)
 *
 * 나중에 정식으로 자동 생성하려면:
 *   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.ts
 */

export interface Database {
  public: {
    Tables: {
      trips: {
        Row: {
          id: string;
          name: string;
          start_date: string | null;
          end_date: string | null;
          owner_id: string;
          invite_code: string;
          created_at: string;
          headcount: number | null;
          theme: string | null;
          dest_lat: number | null;
          dest_lng: number | null;
          destinations: string[] | null;
          dest_coords: Record<string, unknown> | null;
          shortlist_zone_name: string | null;
          shortlist_zone_place_ids: string[] | null;
          shortlist_basecamp_place_id: string | null;
          shortlist_confirmed_place_ids: string[] | null;
        };
        Insert: {
          id?: string;
          name: string;
          start_date?: string | null;
          end_date?: string | null;
          owner_id: string;
          invite_code?: string;
          created_at?: string;
          headcount?: number | null;
          theme?: string | null;
          dest_lat?: number | null;
          dest_lng?: number | null;
          destinations?: string[] | null;
          dest_coords?: Record<string, unknown> | null;
          shortlist_zone_name?: string | null;
          shortlist_zone_place_ids?: string[] | null;
          shortlist_basecamp_place_id?: string | null;
          shortlist_confirmed_place_ids?: string[] | null;
        };
        Update: Partial<Database['public']['Tables']['trips']['Insert']>;
        Relationships: [];
      };

      trip_members: {
        Row: {
          id: string;
          trip_id: string;
          user_id: string;
          role: string;
          joined_at: string;
          display_name: string | null;
          avatar_url: string | null;
        };
        Insert: {
          id?: string;
          trip_id: string;
          user_id: string;
          role?: string;
          joined_at?: string;
          display_name?: string | null;
          avatar_url?: string | null;
        };
        Update: Partial<Database['public']['Tables']['trip_members']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'trip_members_trip_id_fkey';
            columns: ['trip_id'];
            isOneToOne: false;
            referencedRelation: 'trips';
            referencedColumns: ['id'];
          },
        ];
      };

      places: {
        Row: {
          id: string;
          trip_id: string;
          name: string;
          lat: number | null;
          lng: number | null;
          address: string | null;
          photo_url: string | null;
          category: string | null;
          notes: string | null;
          added_by: string | null;
          created_at: string;
          likes_count: number;
          google_place_id: string | null;
          google_rating: number | null;
          photo_ref: string | null;
          opening_hours: unknown[] | null;
          mood: string | null;
          status: string;
          is_idea: boolean;
          sort_order: number;
        };
        Insert: {
          id?: string;
          trip_id: string;
          name: string;
          lat?: number | null;
          lng?: number | null;
          address?: string | null;
          photo_url?: string | null;
          category?: string | null;
          notes?: string | null;
          added_by?: string | null;
          created_at?: string;
          likes_count?: number;
          google_place_id?: string | null;
          google_rating?: number | null;
          photo_ref?: string | null;
          opening_hours?: unknown[] | null;
          mood?: string | null;
          status?: string;
          is_idea?: boolean;
          sort_order?: number;
        };
        Update: Partial<Database['public']['Tables']['places']['Insert']>;
        Relationships: [];
      };

      city_images: {
        Row: {
          id: string;
          city_ko: string;
          city_en: string;
          image_url: string;
          image_credit: string | null;
          verified: boolean;
          created_at: string;
          updated_at: string;
          image_position: string;
        };
        Insert: {
          id?: string;
          city_ko: string;
          city_en: string;
          image_url: string;
          image_credit?: string | null;
          verified?: boolean;
          created_at?: string;
          updated_at?: string;
          image_position?: string;
        };
        Update: Partial<Database['public']['Tables']['city_images']['Insert']>;
        Relationships: [];
      };

      chat_messages: {
        Row: {
          id: string;
          trip_id: string;
          user_id: string;
          display_name: string | null;
          avatar_url: string | null;
          message: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          user_id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          message: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['chat_messages']['Insert']>;
        Relationships: [];
      };

      place_comments: {
        Row: {
          id: string;
          place_id: string;
          user_id: string;
          display_name: string | null;
          avatar_url: string | null;
          comment: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          place_id: string;
          user_id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          comment: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['place_comments']['Insert']>;
        Relationships: [];
      };

      places_db: {
        Row: {
          id: string;
          name: string;
          name_en: string | null;
          category: string;
          country: string;
          city: string;
          address: string | null;
          lat: number | null;
          lng: number | null;
          google_place_id: string | null;
          google_rating: number | null;
          review_count: number | null;
          photo_url: string | null;
          photo_ref: string | null;
          tags: string[] | null;
          price_level: number | null;
          source: string;
          created_at: string;
          updated_at: string;
          phone: string | null;
          website: string | null;
          opening_hours: unknown[] | null;
        };
        Insert: {
          id?: string;
          name: string;
          name_en?: string | null;
          category: string;
          country: string;
          city: string;
          address?: string | null;
          lat?: number | null;
          lng?: number | null;
          google_place_id?: string | null;
          google_rating?: number | null;
          review_count?: number | null;
          photo_url?: string | null;
          photo_ref?: string | null;
          tags?: string[] | null;
          price_level?: number | null;
          source?: string;
          created_at?: string;
          updated_at?: string;
          phone?: string | null;
          website?: string | null;
          opening_hours?: unknown[] | null;
        };
        Update: Partial<Database['public']['Tables']['places_db']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_trip_by_invite_code: {
        Args: { p_invite_code: string };
        Returns: {
          id: string;
          name: string;
          destinations: string[] | null;
          start_date: string | null;
          end_date: string | null;
          headcount: number | null;
          member_count: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** 자주 쓰는 Row 타입 단축 alias */
export type Trip = Database['public']['Tables']['trips']['Row'];
export type TripMember = Database['public']['Tables']['trip_members']['Row'];
export type Place = Database['public']['Tables']['places']['Row'];
export type CityImage = Database['public']['Tables']['city_images']['Row'];
export type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];
export type PlaceComment = Database['public']['Tables']['place_comments']['Row'];
