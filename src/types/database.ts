/**
 * Supabase 자동생성 타입 플레이스홀더
 *
 * 실제 타입 생성:
 *   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.ts
 *
 * 지금은 컴파일 에러를 막기 위한 최소 껍데기만 둡니다.
 * (각 테이블에 Relationships 필드 필수 — 최신 @supabase/supabase-js 타입 요구사항)
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
          headcount: number | null;
          theme: string | null;
          destinations: string[] | null;
          dest_coords: Record<string, unknown> | null;
          owner_id: string;
          invite_code: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['trips']['Row']> & {
          name: string;
          owner_id: string;
        };
        Update: Partial<Database['public']['Tables']['trips']['Row']>;
        Relationships: [];
      };
      trip_members: {
        Row: {
          trip_id: string;
          user_id: string;
          role: string;
          display_name: string | null;
          avatar_url: string | null;
          added_by: string | null;
        };
        Insert: {
          trip_id: string;
          user_id: string;
          role?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          added_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['trip_members']['Row']>;
        Relationships: [];
      };
      places: {
        Row: {
          id: string;
          trip_id: string;
          name: string;
          address: string | null;
          lat: number | null;
          lng: number | null;
          google_place_id: string | null;
          google_rating: number | null;
          category: string | null;
          photo_url: string | null;
          opening_hours: Record<string, unknown> | null;
          added_by: string | null;
          mood: string | null;
          status: string;
          is_idea: boolean;
          sort_order: number;
          likes_count: number;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['places']['Row']> & {
          trip_id: string;
          name: string;
        };
        Update: Partial<Database['public']['Tables']['places']['Row']>;
        Relationships: [];
      };
      city_images: {
        Row: {
          city_ko: string;
          city_en: string;
          image_url: string;
          image_position: string | null;
          image_credit: string | null;
          verified: boolean;
        };
        Insert: Database['public']['Tables']['city_images']['Row'];
        Update: Partial<Database['public']['Tables']['city_images']['Row']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** 자주 쓰는 Row 타입 단축 alias */
export type Trip = Database['public']['Tables']['trips']['Row'];
export type TripMember = Database['public']['Tables']['trip_members']['Row'];
export type Place = Database['public']['Tables']['places']['Row'];
export type CityImage = Database['public']['Tables']['city_images']['Row'];
