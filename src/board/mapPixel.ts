/**
 * 화면 좌표(마우스 위치) → 지도 좌표. 펜·영역 검색이 구글 지도 이벤트 대신 브라우저 포인터 이벤트로 그릴 때 쓴다.
 *
 * 왜 지도 이벤트를 안 쓰나: 지도 mousedown/mousemove로 그리려면 지도 끌기를 꺼야 하는데(draggable:false),
 * 그러면 휠 확대·축소까지 막히고, 장소 핀 위에서 누르면 핀이 클릭을 먼저 가져간다.
 * 포인터 이벤트를 지도보다 먼저(캡처 단계) 받아 지도로 안 보내면 끌기·핀 클릭은 막히고 휠은 그대로 살아 있다.
 *
 * 빈 OverlayView의 projection을 빌려 쓴다(지도에 붙은 뒤 첫 draw 이후에만 있다 — 없으면 null).
 */
export interface Projector {
  toLatLng(clientX: number, clientY: number): any | null;
  destroy(): void;
}

export function createProjector(g: any, map: any): Projector {
  let ov: any = null;
  try {
    ov = new g.maps.OverlayView();
    ov.onAdd = () => undefined;
    ov.draw = () => undefined;
    ov.onRemove = () => undefined;
    ov.setMap(map);
  } catch {
    ov = null;
  }
  return {
    toLatLng(clientX, clientY) {
      const proj = ov?.getProjection?.();
      if (!proj?.fromContainerPixelToLatLng) return null;
      const r = (map.getDiv() as HTMLElement).getBoundingClientRect();
      return proj.fromContainerPixelToLatLng(new g.maps.Point(clientX - r.left, clientY - r.top));
    },
    destroy() {
      ov?.setMap?.(null);
      ov = null;
    },
  };
}

/** 지도 위 떠 있는 우리 UI(펜 바·영역 선택 창·정보창) 위에서 누른 건 그리기로 보지 않는다 */
export function isOverlayUi(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('.bd-pen-float, .bd-area-pop, .gm-style-iw-c, .gm-style-iw, button, input, a, .gmnoprint');
}
