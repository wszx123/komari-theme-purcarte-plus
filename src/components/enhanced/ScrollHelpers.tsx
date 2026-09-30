import { useState, useEffect, useCallback, useRef } from "react";

export function ScrollHelpers() {
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);
  const rafRef = useRef<number>(0);

  const getScrollContainer = useCallback((): Element | null => {
    return (
      document.querySelector("[data-radix-scroll-area-viewport]") ||
      document.documentElement
    );
  }, []);

  const performScroll = useCallback(
    (pos: "top" | "bottom") => {
      const container = getScrollContainer();
      if (!container) return;
      const targetY =
        pos === "top"
          ? 0
          : container.scrollHeight || document.documentElement.scrollHeight;
      container.scrollTo({ top: targetY, behavior: "smooth" });
      window.scrollTo({ top: targetY, behavior: "smooth" });
    },
    [getScrollContainer]
  );

  const handleScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const container = getScrollContainer();
      if (!container) return;
      const scrollTop = Math.max(
        container.scrollTop,
        window.scrollY,
        document.documentElement.scrollTop
      );
      const clientHeight = container.clientHeight || window.innerHeight;
      const scrollHeight = Math.max(
        container.scrollHeight,
        document.documentElement.scrollHeight
      );
      const thresholdTop = 15;
      const thresholdBottom = 15;

      setShowTop(scrollTop > thresholdTop);
      setShowBottom(
        !(
          scrollTop + clientHeight >= scrollHeight - thresholdBottom ||
          scrollHeight <= clientHeight + 20
        )
      );
    });
  }, [getScrollContainer]);

  useEffect(() => {
    const container = getScrollContainer();
    window.addEventListener("scroll", handleScroll, { passive: true });
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true });
    }

    const resizeObserver = new ResizeObserver(() => handleScroll());
    if (container) resizeObserver.observe(container);
    resizeObserver.observe(document.body);

    const interval = setInterval(handleScroll, 1500);
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (container) {
        container.removeEventListener("scroll", handleScroll);
      }
      resizeObserver.disconnect();
      clearInterval(interval);
      cancelAnimationFrame(rafRef.current);
    };
  }, [handleScroll, getScrollContainer]);

  return (
    <>
      <div
        id="scroll-to-top"
        className={`scroll-helper-btn${showTop ? " show" : ""}`}
        onClick={() => performScroll("top")}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round">
          <path d="m18 15-6-6-6 6" />
        </svg>
      </div>
      <div
        id="scroll-to-bottom"
        className={`scroll-helper-btn${showBottom ? " show" : ""}`}
        onClick={() => performScroll("bottom")}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </>
  );
}
