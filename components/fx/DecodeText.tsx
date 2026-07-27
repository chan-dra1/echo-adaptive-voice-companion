import React, { useEffect, useRef, useState } from 'react';

/**
 * DecodeText — Matrix-style text materialization.
 * Characters scramble through katakana/glyph noise, then lock in
 * left-to-right. Fires once on mount (or when `text` changes).
 *
 * Respects prefers-reduced-motion: renders the plain text instantly.
 */

const GLYPHS =
    'アイウエオカキクケコサシスセソタチツテトナニヌネノABCDEF0123456789<>[]{}#$%&*+=?';

interface DecodeTextProps {
    text: string;
    /** ms before the decode starts */
    delay?: number;
    /** ms per character lock-in (lower = faster) */
    speed?: number;
    className?: string;
    style?: React.CSSProperties;
    as?: keyof React.JSX.IntrinsicElements;
}

const DecodeText: React.FC<DecodeTextProps> = ({
    text,
    delay = 0,
    speed = 28,
    className,
    style,
    as: Tag = 'span',
}) => {
    const [display, setDisplay] = useState(() => text);
    const [done, setDone] = useState(false);
    const rafRef = useRef<number>(0);
    const timerRef = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => {
        const reduced =
            typeof window !== 'undefined' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced || !text) {
            setDisplay(text);
            setDone(true);
            return;
        }

        setDone(false);
        let start: number | null = null;

        const tick = (now: number) => {
            if (start === null) start = now;
            const elapsed = now - start;
            // how many chars are locked in
            const locked = Math.floor(elapsed / speed);
            if (locked >= text.length) {
                setDisplay(text);
                setDone(true);
                return;
            }
            let out = text.slice(0, locked);
            for (let i = locked; i < text.length; i++) {
                const ch = text[i];
                out += ch === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
            }
            setDisplay(out);
            rafRef.current = requestAnimationFrame(tick);
        };

        timerRef.current = setTimeout(() => {
            rafRef.current = requestAnimationFrame(tick);
        }, delay);

        return () => {
            clearTimeout(timerRef.current);
            cancelAnimationFrame(rafRef.current);
        };
    }, [text, delay, speed]);

    return (
        <Tag className={className} style={style} data-decoded={done ? '1' : '0'} aria-label={text}>
            {display}
        </Tag>
    );
};

export default React.memo(DecodeText);
