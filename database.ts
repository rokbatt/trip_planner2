/**
 * Supabase 자동생성 타입
 *
 * 실제 타입은 아래 명령으로 덮어쓰세요:
 *   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.ts
 *
 * 지금은 개발 시작용 수동 스텁입니다.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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
          dest_coords: Json | null;
          owner_id: string;
          invite_code: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['trips']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['trips']['Insert']>;
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
        Insert: Database['public']['Tables']['trip_members']['Row'];
        Update: Partial<Database['public']['Tables']['trip_members']['Insert']>;
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
          opening_hours: Json | null;
          added_by: string | null;
          mood: string | null;
          status: string;
          is_idea: boolean;
          sort_order: number;
          likes_count: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['places']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['places']['Insert']>;
      };
      itinerary_items: {
        Row: {
          id: string;
          trip_id: string;
          place_id: string | null;
          title: string;
          date: string;
          start_time: string | null;
          sort_order: number;
          notes: string | null;
          estimated_cost: number | null;
          travel_distance_m: number | null;
          travel_duration_s: number | null;
          travel_polyline: string | null;
          travel_mode: string | null;
        };
        Insert: Omit<Database['public']['Tables']['itinerary_items']['Row'], 'id'> & {
          id?: string;
        };
        Update: Partial<Database['public']['Tables']['itinerary_items']['Insert']>;
      };
      place_reactions: {
        Row: {
          place_id: string;
          user_id: string;
          emoji: string;
        };
        Insert: Database['public']['Tables']['place_reactions']['Row'];
        Update: Partial<Database['public']['Tables']['place_reactions']['Insert']>;
      };
      chat_messages: {
        Row: {
          id: string;
          trip_id: string;
          user_id: string;
          message: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['chat_messages']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['chat_messages']['Insert']>;
      };
      city_images: {
        Row: {
          city_ko: string;
          city_en: string | null;
          image_url: string;
          image_position: string | null;
          image_credit: string | null;
          verified: boolean;
        };
        Insert: Database['public']['Tables']['city_images']['Row'];
        Update: Partial<Database['public']['Tables']['city_images']['Insert']>;
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
  };
}
