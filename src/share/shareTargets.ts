/**
 * 공유 대상 링크 만들기 — 순수 함수(시험용). 각 서비스의 "공유 주소"에 링크·문구를 넣는다.
 * API 키가 필요 없는 공개 공유 주소만 쓴다. 카카오톡은 SDK + 앱 키가 있어야 해서 따로 다룬다(shareSheet.ts).
 */
export interface ShareTarget {
  key: string;
  label: string;
  href: string;
  /** 휴대폰에서만 의미 있는 것(문자) */
  mobileOnly?: boolean;
}

export function shareTargets(url: string, text: string): ShareTarget[] {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  const both = encodeURIComponent(text + '\n' + url);
  return [
    { key: 'sms', label: '문자', href: 'sms:?&body=' + both, mobileOnly: true },
    { key: 'line', label: 'LINE', href: 'https://social-plugins.line.me/lineit/share?url=' + u },
    { key: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/?text=' + both },
    { key: 'telegram', label: 'Telegram', href: 'https://t.me/share/url?url=' + u + '&text=' + t },
    { key: 'x', label: 'X', href: 'https://x.com/intent/post?text=' + t + '&url=' + u },
    { key: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/sharer/sharer.php?u=' + u },
    { key: 'email', label: '이메일', href: 'mailto:?subject=' + t + '&body=' + both },
  ];
}
