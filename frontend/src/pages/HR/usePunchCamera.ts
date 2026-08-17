import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../utils/apiClient';

/**
 * Camera capture for the attendance station.
 *
 * The photo is the substitute for a biometric device: it does not prove
 * identity, it makes substitution visible after the fact (docs/HRM.md §11).
 *
 * Deliberately fail-soft. If the camera is missing, blocked, or the upload
 * fails, the punch still goes through and is flagged photo-less in the
 * exceptions report — refusing to let someone clock in because a webcam is
 * unplugged would be a worse outcome than a gap in the evidence.
 */
export function usePunchCamera(enabled: boolean) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;

        const start = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'user', width: 480, height: 360 },
                    audio: false,
                });
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play().catch(() => undefined);
                }
                setReady(true);
            } catch {
                setError('Camera unavailable — punches will be recorded without a photo');
                setReady(false);
            }
        };
        void start();

        return () => {
            cancelled = true;
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
            setReady(false);
        };
    }, [enabled]);

    /** Grab a frame, upload it, and return the URL — or null on any failure. */
    const capture = useCallback(async (): Promise<string | null> => {
        const video = videoRef.current;
        if (!enabled || !ready || !video || video.videoWidth === 0) return null;

        try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const blob = await new Promise<Blob | null>((resolve) =>
                // JPEG at 0.7: legible enough to recognise a face, small enough
                // that a busy branch is not uploading megabytes per punch.
                canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.7),
            );
            if (!blob) return null;

            const form = new FormData();
            form.append('file', blob, `punch-${Date.now()}.jpg`);
            form.append('folder', 'attendance');
            const { data } = await apiClient.post('/upload', form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return (data?.url as string) ?? null;
        } catch {
            return null;
        }
    }, [enabled, ready]);

    return { videoRef, ready, error, capture };
}
