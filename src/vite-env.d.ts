/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_GOOGLE_MAPS_KEY: string;
  /** 웹 푸시 공개 키(VAPID). 없으면 알림 켜기가 "준비 중"으로 보인다 */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  /** 결제(포트원) — 없으면 요금제 화면이 "결제 준비 중"(src/pay/payClient.ts) */
  readonly VITE_PORTONE_STORE_ID?: string;
  readonly VITE_PORTONE_CHANNEL_CARD?: string;
  readonly VITE_PORTONE_CHANNEL_TOSSPAY?: string;
  readonly VITE_PORTONE_CHANNEL_KAKAOPAY?: string;
  /** "on"이면 약관·방침 유료 조항 시행 + 버전 올림(src/legal/versions.ts) */
  readonly VITE_PAID_TERMS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
