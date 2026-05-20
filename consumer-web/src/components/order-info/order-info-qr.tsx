"use client";

import { useMemo } from "react";
import QRCode from "react-qr-code";
import {
  orderRedirectConfig,
  resolveOrderInfoAssetUrl,
} from "@/lib/config/order-redirect";

type OrderInfoQrProps = {
  className?: string;
  size?: number;
};

export function OrderInfoQr({ className, size = 140 }: OrderInfoQrProps) {
  const qrImageSrc = useMemo(() => {
    return resolveOrderInfoAssetUrl(orderRedirectConfig.qrImageUrl);
  }, []);

  const qrTarget = orderRedirectConfig.qrTargetUrl.trim();

  if (qrImageSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={qrImageSrc}
        alt="Scan to download the Foodies app"
        width={size}
        height={size}
        className={className}
      />
    );
  }

  if (!qrTarget) return null;

  return (
    <QRCode
      value={qrTarget}
      size={size}
      level="M"
      className={className}
      aria-label="QR code to download the Foodies app"
    />
  );
}
