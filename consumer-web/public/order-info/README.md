# Order-info page assets

Assets for the Foodies app landing page at `/order-info`.

| File | Purpose | Recommended size |
|------|---------|------------------|
| `hero-phone.png` | Hero center phone mockup with app UI | Portrait, ~600×1200 |
| `hero-lifestyle.jpg` | Optional alternate hero / marketing photo | Landscape, min 1200×800 |
| `food-bowl.jpg` | Round food image in the scan/download section | Square, min 800×800 |
| `qr-download.png` | Pre-made QR (optional; auto-generated if omitted) | Square, 512×512+ |
| `landing-reference.png` | Full design reference (included) | — |

Set paths in `consumer-web/.env.local` — see [`.env.example`](../../.env.example).

If `NEXT_PUBLIC_ORDER_PHONE_MOCKUP_URL` is empty, a built-in phone UI mockup is shown in the hero.
