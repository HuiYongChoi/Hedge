import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/** 요소를 감싼 스크롤 컨테이너를 찾는다. */
function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * sticky 사이드바가 실제로 쓸 수 있는 높이.
 *
 * 리포트는 화면(window)이 아니라 앱 안쪽의 `overflow-y-auto` 영역에서 스크롤된다.
 * 그 영역의 보이는 높이는 화면 높이보다 한참 작다 — 위쪽을 탭 바·종목 리본이
 * 차지하기 때문이다. 그래서 높이를 100vh 기준으로 잡으면 sticky 로 고정된
 * 사이드바의 아래쪽이 화면 밖으로 밀려, 마지막 카드에는 사이드바를 아무리
 * 스크롤해도 닿지 않고 본문을 내려야만 보인다. 실제 스크롤 영역의 높이를 재서
 * 그만큼만 차지하게 한다.
 */
export function useScrollAreaHeight(
  ref: RefObject<HTMLElement>,
  gapPx: number,
): number | null {
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const scroller = findScrollParent(element);
    const measure = () => {
      const visible = scroller ? scroller.clientHeight : window.innerHeight;
      if (visible > 0) setMaxHeight(Math.max(200, visible - gapPx));
    };

    measure();
    // 탭이 막 열려 컨테이너 높이가 아직 0 인 순간에 잡히면 값이 그대로 굳는다.
    // 다음 프레임에 한 번 더 잰다.
    const raf = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(scroller ?? document.documentElement);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, gapPx]);

  return maxHeight;
}
