import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadStationPhoto } from '../../services/api/stationService';

export type CameraStatus =
    | 'off'
    | 'starting'
    | 'ready'
    | 'capturing'
    | 'uploading'
    | 'error';

export type CaptureOutcome =
    | { url: string; reason: null }
    | { url: null; reason: string };

/** Wait for the first decoded frame; a video element reports 0×0 until then. */
async function waitForFrame(
    video: HTMLVideoElement,
    timeoutMs = 3000,
): Promise<boolean> {
    if (video.videoWidth > 0) return true;
    return new Promise((resolve) => {
        const done = (ok: boolean) => {
            video.removeEventListener('loadeddata', onData);
            clearTimeout(timer);
            resolve(ok);
        };
        const onData = () => done(video.videoWidth > 0);
        const timer = setTimeout(() => done(video.videoWidth > 0), timeoutMs);
        video.addEventListener('loadeddata', onData);
    });
}

/**
 * Camera capture for the attendance station.
 *
 * The photo is the substitute for a biometric device: it does not prove
 * identity, it makes substitution visible after the fact (docs/HRM.md §11).
 *
 * Still deliberately fail-soft — a punch is never refused because a webcam is
 * unplugged — but no longer fail-SILENT. Every failure returns a reason the
 * station shows on screen, because "the photos are not saving" with nothing on
 * screen to say why is worse than either outcome on its own.
 */
export function usePunchCamera(enabled: boolean, stationToken?: string | null) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [status, setStatus] = useState<CameraStatus>('off');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled) {
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
            setStatus('off');
            return;
        }
        let cancelled = false;
        setStatus('starting');
        setError(null);

        const start = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'user', width: 640, height: 480 },
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
                setStatus('ready');
            } catch (e) {
                setError(
                    e instanceof DOMException && e.name === 'NotAllowedError'
                        ? 'Camera blocked — allow it in the browser, or punches record without a photo'
                        : 'Camera unavailable — punches record without a photo',
                );
                setStatus('error');
            }
        };
        void start();

        return () => {
            cancelled = true;
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        };
    }, [enabled]);

    /**
     * Attach the live stream to whichever element is currently mounted.
     *
     * The preview lives inside a conditional branch, so React can hand the hook
     * a NEW element without the stream-starting effect re-running. The old code
     * kept a stream nobody was displaying and captured 0×0 frames from an
     * element with no source.
     */
    const attachVideo = useCallback((el: HTMLVideoElement | null) => {
        videoRef.current = el;
        if (el && streamRef.current && el.srcObject !== streamRef.current) {
            el.srcObject = streamRef.current;
            void el.play().catch(() => undefined);
        }
    }, []);

    /** Grab a frame, upload it, and return the URL — or a reason it failed. */
    const capture = useCallback(async (): Promise<CaptureOutcome> => {
        if (!enabled) return { url: null, reason: 'photo turned off' };
        if (!stationToken) return { url: null, reason: 'device not registered' };
        const video = videoRef.current;
        if (!video || !streamRef.current) {
            return { url: null, reason: 'camera not started' };
        }

        try {
            setStatus('capturing');
            // A cold camera reports 0×0 for a moment. Waiting a beat is the
            // difference between a photo and a silent miss on the first punch
            // after the screen opens.
            const framed = await waitForFrame(video);
            if (!framed) {
                setStatus('ready');
                return { url: null, reason: 'camera produced no frame' };
            }

            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                setStatus('ready');
                return { url: null, reason: 'browser could not draw the frame' };
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const blob = await new Promise<Blob | null>((resolve) =>
                // JPEG at 0.7: legible enough to recognise a face, small enough
                // that a busy branch is not uploading megabytes per punch.
                canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.7),
            );
            if (!blob || blob.size === 0) {
                setStatus('ready');
                return { url: null, reason: 'empty image' };
            }

            setStatus('uploading');
            // Uploaded with the DEVICE token: the station has no user session,
            // and the shared upload endpoint requires one.
            const uploaded = await uploadStationPhoto(stationToken, blob);
            setStatus('ready');
            return uploaded.url
                ? { url: uploaded.url, reason: null }
                : { url: null, reason: uploaded.reason ?? 'upload failed' };
        } catch (e) {
            setStatus('ready');
            return {
                url: null,
                reason: e instanceof Error ? e.message : 'capture failed',
            };
        }
    }, [enabled, stationToken]);

    return {
        videoRef: attachVideo,
        status,
        ready: status === 'ready' || status === 'capturing' || status === 'uploading',
        error,
        capture,
    };
}
