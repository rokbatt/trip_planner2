import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkPublicUrlShape, isPrivateAddress, isValidLinkId, safePublicFetch } from '../../api/cache-photo';

/**
 * 링크 미리보기 서버가 대신 요청해도 되는 주소의 규칙(SSRF 방어, Claude.md 5-11).
 * 느슨해지면 서버 안쪽에서만 닿는 주소(클라우드 메타데이터·사설망)를 바깥에서 열 수 있다.
 */

describe('isPrivateAddress', () => {
  it('사설·루프백·링크로컬·메타데이터 IPv4는 막는다', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it('공인 IPv4는 통과한다', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '1.1.1.1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
  it('IPv6 루프백·고유로컬·링크로컬·IPv4 매핑 사설 주소는 막는다', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '[::1]']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });
  it('형식을 모르는 값은 막는다', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('checkPublicUrlShape', () => {
  it('http(s) 기본 포트 주소만 통과', () => {
    expect(checkPublicUrlShape('https://blog.naver.com/a/1')).not.toBeNull();
    expect(checkPublicUrlShape('http://example.com:80/x')).not.toBeNull();
  });
  it('다른 프로토콜·포트·계정 정보·내부 이름은 막는다', () => {
    expect(checkPublicUrlShape('file:///etc/passwd')).toBeNull();
    expect(checkPublicUrlShape('ftp://example.com')).toBeNull();
    expect(checkPublicUrlShape('http://example.com:8080/')).toBeNull();
    expect(checkPublicUrlShape('http://user:pw@example.com/')).toBeNull();
    expect(checkPublicUrlShape('http://localhost/')).toBeNull();
    expect(checkPublicUrlShape('http://metadata.google.internal/')).toBeNull();
    expect(checkPublicUrlShape('not a url')).toBeNull();
  });
});

describe('isValidLinkId', () => {
  it('UUID와 예전 대체 형식은 통과, 경로 문자는 막는다', () => {
    expect(isValidLinkId('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true);
    expect(isValidLinkId('1731420000000-0.4821')).toBe(true);
    expect(isValidLinkId('../other')).toBe(false);
    expect(isValidLinkId('a/b/cdefgh')).toBe(false);
    expect(isValidLinkId('short')).toBe(false);
    expect(isValidLinkId(undefined)).toBe(false);
  });
});

describe('safePublicFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('사설 IP로는 처음부터 요청하지 않는다', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(safePublicFetch('http://169.254.169.254/latest/meta-data/', {})).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it('공인 주소가 사설 주소로 리다이렉트하면 따라가지 않는다', async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }));
    vi.stubGlobal('fetch', f);
    await expect(safePublicFetch('http://93.184.216.34/', {})).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as any[])[1].redirect).toBe('manual');
  });

  it('공인 주소끼리의 리다이렉트는 따라간다', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://1.1.1.1/b' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const res = await safePublicFetch('http://93.184.216.34/a', {});
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
