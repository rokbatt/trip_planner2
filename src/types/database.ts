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
          shortlist_total_budget_krw: number | null;
          shortlist_basecamp_confirmed_at: string | null;
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
          shortlist_total_budget_krw?: number | null;
          shortlist_basecamp_confirmed_at?: string | null;
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
          destination_id: string | null;
          group_id: string | null;
          group_name: string | null;
          group_order: number | null;
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
          destination_id?: string | null;
          group_id?: string | null;
          group_name?: string | null;
          group_order?: number | null;
        };
        Update: Partial<Database['public']['Tables']['places']['Insert']>;
        Relationships: [];
      };

      trip_destinations: {
        Row: {
          id: string;
          trip_id: string;
          name: string;
          lat: number | null;
          lng: number | null;
          start_date: string | null;
          end_date: string | null;
          sort_order: number;
          created_at: string;
          /** DAY 1의 시작점 — 공항 이름(자동완성에서 고른 실제 공항, 예: "수완나품 국제공항") */
          arrival_airport: string | null;
          /** 공항 도착 예정 시각 'HH:MM' (24시간) */
          arrival_time: string | null;
          /** 자동완성에서 실제로 고른 공항의 좌표 — 있어야 지도 위 진짜 정류지로 취급됨 */
          arrival_lat: number | null;
          arrival_lng: number | null;
          /** getPlaceDetails로 받아온 실제 사진/평점 — 자동완성에서 실제로 고른 경우에만 채워짐 */
          arrival_photo_url: string | null;
          arrival_rating: number | null;
          /** 마지막 DAY의 종료점 — 출국 공항 (arrival_*와 동일한 구조) */
          departure_airport: string | null;
          departure_time: string | null;
          departure_lat: number | null;
          departure_lng: number | null;
          departure_photo_url: string | null;
          departure_rating: number | null;
          /** "AI 일정 짜기"에 매번 그대로 전달되는 자유 텍스트 요청사항(여행 컨셉/니즈/Day별 지시 등) */
          ai_plan_notes: string | null;
        };
        Insert: {
          id?: string;
          trip_id: string;
          name: string;
          lat?: number | null;
          lng?: number | null;
          start_date?: string | null;
          end_date?: string | null;
          sort_order?: number;
          created_at?: string;
          arrival_airport?: string | null;
          arrival_time?: string | null;
          arrival_lat?: number | null;
          arrival_lng?: number | null;
          arrival_photo_url?: string | null;
          arrival_rating?: number | null;
          departure_airport?: string | null;
          departure_time?: string | null;
          departure_lat?: number | null;
          departure_lng?: number | null;
          departure_photo_url?: string | null;
          departure_rating?: number | null;
          ai_plan_notes?: string | null;
        };
        Update: Partial<Database['public']['Tables']['trip_destinations']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'trip_destinations_trip_id_fkey';
            columns: ['trip_id'];
            isOneToOne: false;
            referencedRelation: 'trips';
            referencedColumns: ['id'];
          },
        ];
      };

      stay_segments: {
        Row: {
          id: string;
          trip_id: string;
          destination_id: string | null;
          sort_order: number;
          start_date: string | null;
          end_date: string | null;
          zone_name: string | null;
          zone_place_ids: string[] | null;
          basecamp_place_id: string | null;
          confirmed_place_ids: string[] | null;
          total_budget_krw: number | null;
          basecamp_confirmed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          destination_id?: string | null;
          sort_order?: number;
          start_date?: string | null;
          end_date?: string | null;
          zone_name?: string | null;
          zone_place_ids?: string[] | null;
          basecamp_place_id?: string | null;
          confirmed_place_ids?: string[] | null;
          total_budget_krw?: number | null;
          basecamp_confirmed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['stay_segments']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'stay_segments_trip_id_fkey';
            columns: ['trip_id'];
            isOneToOne: false;
            referencedRelation: 'trips';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stay_segments_destination_id_fkey';
            columns: ['destination_id'];
            isOneToOne: false;
            referencedRelation: 'trip_destinations';
            referencedColumns: ['id'];
          },
        ];
      };

      /* ROUTE 게이트 — 하루 동선(supabase/route_plan.sql) */
      route_days: {
        Row: {
          id: string;
          trip_id: string;
          destination_id: string | null;
          day_index: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          destination_id?: string | null;
          day_index: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['route_days']['Insert']>;
        Relationships: [];
      };

      route_stops: {
        Row: {
          id: string;
          route_day_id: string;
          trip_id: string;
          place_id: string | null;
          sort_order: number;
          arrive_time: string | null;
          memo: string | null;
          travel_mode: string | null;
          custom_name: string | null;
          custom_lat: number | null;
          custom_lng: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          route_day_id: string;
          trip_id: string;
          place_id?: string | null;
          sort_order?: number;
          arrive_time?: string | null;
          memo?: string | null;
          travel_mode?: string | null;
          custom_name?: string | null;
          custom_lat?: number | null;
          custom_lng?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['route_stops']['Insert']>;
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
          edited_at: string | null;
        };
        Insert: {
          id?: string;
          trip_id: string;
          user_id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          message: string;
          created_at?: string;
          edited_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['chat_messages']['Insert']>;
        Relationships: [];
      };

      trip_links: {
        Row: {
          id: string;
          trip_id: string;
          chat_message_id: string | null;
          url: string;
          message: string | null;
          title: string | null;
          image_url: string | null;
          site_name: string | null;
          category: string;
          added_by: string | null;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          chat_message_id?: string | null;
          url: string;
          message?: string | null;
          title?: string | null;
          image_url?: string | null;
          site_name?: string | null;
          category?: string;
          added_by?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['trip_links']['Insert']>;
        Relationships: [];
      };

      /* EXPENSE 게이트 — 예산·지출(supabase/trip_expenses.sql) */
      trip_expense_budgets: {
        Row: {
          id: string;
          trip_id: string;
          category: string;
          amount_krw: number | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          category: string;
          amount_krw?: number | null;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['trip_expense_budgets']['Insert']>;
        Relationships: [];
      };

      trip_expenses: {
        Row: {
          id: string;
          trip_id: string;
          destination_id: string | null;
          category: string;
          title: string;
          amount: number;
          currency: string;
          /** 저장 시점 환율로 환산한 원화 — 집계/차트는 전부 이 값 기준 */
          amount_krw: number | null;
          fx_rate: number | null;
          fx_source: string | null;
          expense_date: string | null;
          is_paid: boolean;
          /** 'SHARED'(공동, 정산 대상) | 'PERSONAL'(개인, 정산 제외) */
          split_mode: string;
          paid_by: string | null;
          paid_by_name: string | null;
          paid_by_avatar: string | null;
          /** 나눠 낼 멤버 user_id 목록 — null이면 전원 */
          split_user_ids: string[] | null;
          memo: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          trip_id: string;
          destination_id?: string | null;
          category?: string;
          title: string;
          amount: number;
          currency?: string;
          amount_krw?: number | null;
          fx_rate?: number | null;
          fx_source?: string | null;
          expense_date?: string | null;
          is_paid?: boolean;
          split_mode?: string;
          paid_by?: string | null;
          paid_by_name?: string | null;
          paid_by_avatar?: string | null;
          split_user_ids?: string[] | null;
          memo?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['trip_expenses']['Insert']>;
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
export type TripLink = Database['public']['Tables']['trip_links']['Row'];
export type PlaceComment = Database['public']['Tables']['place_comments']['Row'];
export type TripDestination = Database['public']['Tables']['trip_destinations']['Row'];
export type StaySegment = Database['public']['Tables']['stay_segments']['Row'];
export type TripExpense = Database['public']['Tables']['trip_expenses']['Row'];
export type TripExpenseBudget = Database['public']['Tables']['trip_expense_budgets']['Row'];
