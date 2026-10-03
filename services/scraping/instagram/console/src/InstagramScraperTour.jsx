"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, MousePointer2, Play, X } from "lucide-react";
import { createPortal } from "react-dom";

const SPOTLIGHT_GAP = 11;

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

function InstagramScraperTour({ open, stepIndex, steps, onBack, onClose, onNext }) {
  const cardRef = useRef(null);
  const [cardSize, setCardSize] = useState({ width: 360, height: 280 });
  const [targetRect, setTargetRect] = useState(null);
  const [viewport, setViewport] = useState(() => typeof window === "undefined"
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight });
  const step = steps[stepIndex];

  const measureTarget = useCallback(() => {
    if (!open || !step?.target) {
      setTargetRect(null);
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      return null;
    }

    const target = document.querySelector(step.target);
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    setTargetRect({
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height
    });
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    return target;
  }, [open, step?.target]);

  useLayoutEffect(() => {
    if (!open || !cardRef.current) return undefined;
    const card = cardRef.current;
    const updateCardSize = () => {
      const rect = card.getBoundingClientRect();
      setCardSize({ width: rect.width, height: rect.height });
    };
    updateCardSize();
    const observer = new ResizeObserver(updateCardSize);
    observer.observe(card);
    return () => observer.disconnect();
  }, [open, stepIndex]);

  useEffect(() => {
    if (!open) return undefined;

    let target;
    let observer;
    let retryFrame;
    let settleTimer;

    const connect = () => {
      target = measureTarget();
      if (step?.target && !target) {
        retryFrame = window.requestAnimationFrame(connect);
        return;
      }

      if (!target) return;
      target.classList.add("instagram-tour-target");
      const rect = target.getBoundingClientRect();
      const outsideViewport = rect.top < 88 || rect.bottom > window.innerHeight - 88;
      if (outsideViewport) {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        settleTimer = window.setTimeout(measureTarget, reduceMotion ? 0 : 380);
      }

      observer = new ResizeObserver(measureTarget);
      observer.observe(target);
    };

    connect();
    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget, true);

    return () => {
      window.cancelAnimationFrame(retryFrame);
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget, true);
      observer?.disconnect();
      target?.classList.remove("instagram-tour-target");
    };
  }, [measureTarget, open, step?.target, stepIndex]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open || !step || typeof document === "undefined") return null;

  const hasTarget = Boolean(step.target && targetRect);
  const focusRect = hasTarget ? {
    top: Math.max(0, targetRect.top - SPOTLIGHT_GAP),
    left: Math.max(0, targetRect.left - SPOTLIGHT_GAP),
    right: Math.min(viewport.width, targetRect.right + SPOTLIGHT_GAP),
    bottom: Math.min(viewport.height, targetRect.bottom + SPOTLIGHT_GAP)
  } : null;

  const focusWidth = focusRect ? focusRect.right - focusRect.left : 0;
  const focusHeight = focusRect ? focusRect.bottom - focusRect.top : 0;
  const mobile = viewport.width < 720;

  let cardStyle;
  let cardPlacement = "center";
  if (!hasTarget) {
    cardStyle = {
      left: Math.max(16, (viewport.width - cardSize.width) / 2),
      top: Math.max(16, (viewport.height - cardSize.height) / 2)
    };
  } else if (mobile) {
    const placeAtTop = focusRect.top + focusHeight / 2 > viewport.height / 2;
    cardPlacement = placeAtTop ? "mobile-top" : "mobile-bottom";
    cardStyle = {
      left: 12,
      top: placeAtTop ? 12 : Math.max(12, viewport.height - cardSize.height - 12),
      width: Math.max(280, viewport.width - 24)
    };
  } else {
    const gap = 24;
    const edge = 18;
    const roomRight = viewport.width - focusRect.right;
    const roomLeft = focusRect.left;
    const roomBelow = viewport.height - focusRect.bottom;

    if (roomRight >= cardSize.width + gap) {
      cardPlacement = "right";
      cardStyle = {
        left: focusRect.right + gap,
        top: clamp(focusRect.top + focusHeight / 2 - cardSize.height / 2, edge, viewport.height - cardSize.height - edge)
      };
    } else if (roomLeft >= cardSize.width + gap) {
      cardPlacement = "left";
      cardStyle = {
        left: focusRect.left - cardSize.width - gap,
        top: clamp(focusRect.top + focusHeight / 2 - cardSize.height / 2, edge, viewport.height - cardSize.height - edge)
      };
    } else if (roomBelow >= cardSize.height + gap) {
      cardPlacement = "below";
      cardStyle = {
        left: clamp(focusRect.left + focusWidth / 2 - cardSize.width / 2, edge, viewport.width - cardSize.width - edge),
        top: focusRect.bottom + gap
      };
    } else {
      cardPlacement = "above";
      cardStyle = {
        left: clamp(focusRect.left + focusWidth / 2 - cardSize.width / 2, edge, viewport.width - cardSize.width - edge),
        top: Math.max(edge, focusRect.top - cardSize.height - gap)
      };
    }
  }

  const pointerStyle = hasTarget ? {
    left: clamp(targetRect.left + Math.min(targetRect.width * 0.72, targetRect.width - 18), 14, viewport.width - 42),
    top: clamp(targetRect.top + Math.min(targetRect.height * 0.6, targetRect.height - 12), 14, viewport.height - 48)
  } : null;

  return createPortal(
    <div className="instagram-tour" aria-live="polite">
      {hasTarget ? (
        <>
          <div className="instagram-tour-shade shade-top" style={{ height: focusRect.top }} />
          <div className="instagram-tour-shade shade-left" style={{ top: focusRect.top, width: focusRect.left, height: focusHeight }} />
          <div className="instagram-tour-shade shade-right" style={{ top: focusRect.top, left: focusRect.right, height: focusHeight }} />
          <div className="instagram-tour-shade shade-bottom" style={{ top: focusRect.bottom }} />
          <div
            className="instagram-tour-focus"
            key={`${step.id}-focus`}
            style={{
              top: focusRect.top,
              left: focusRect.left,
              width: focusWidth,
              height: focusHeight
            }}
          />
          {step.pointer !== false && (
            <div className={`instagram-tour-pointer is-${step.pointerDirection || "tap"}`} key={`${step.id}-pointer`} style={pointerStyle}>
              <MousePointer2 size={25} strokeWidth={1.8} aria-hidden="true" />
              {step.pointerLabel && <span>{step.pointerLabel}</span>}
            </div>
          )}
        </>
      ) : <div className="instagram-tour-shade shade-full" />}

      <section
        ref={cardRef}
        className={`instagram-tour-card is-${cardPlacement} ${step.id === "welcome" ? "is-welcome" : ""}`}
        style={cardStyle}
        role="dialog"
        aria-label="Instagram scraper user guide"
      >
        <button className="instagram-tour-close" type="button" aria-label="Close user guide" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>

        {step.id === "welcome" ? (
          <div className="instagram-tour-welcome-icon" aria-hidden="true">
            <Play size={22} fill="currentColor" />
          </div>
        ) : (
          <div className="instagram-tour-progress" aria-label={`Step ${step.progress} of 4`}>
            <span>{step.progress} of 4</span>
            <div>
              {[1, 2, 3, 4].map((item) => (
                <i key={item} className={item <= step.progress ? "is-complete" : ""} />
              ))}
            </div>
          </div>
        )}

        <p className="instagram-tour-kicker">{step.kicker}</p>
        <h2>{step.title}</h2>
        <p className="instagram-tour-copy">{step.copy}</p>
        {step.note && (
          <div className="instagram-tour-note">
            <Check size={15} aria-hidden="true" />
            <span>{step.note}</span>
          </div>
        )}

        <footer className="instagram-tour-actions">
          {step.id !== "welcome" && (
            <button type="button" className="instagram-tour-skip" onClick={onClose}>Skip guide</button>
          )}
          <div>
            {stepIndex > 0 && (
              <button type="button" className="instagram-tour-back" onClick={onBack}>
                <ArrowLeft size={16} aria-hidden="true" /> Back
              </button>
            )}
            <button type="button" className="instagram-tour-next" onClick={onNext}>
              {step.nextLabel}
              {step.isLast ? <Check size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
}

export default InstagramScraperTour;
