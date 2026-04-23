import Swal from 'sweetalert2';

export async function confirmDialog(opts: {
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  icon?: 'warning' | 'question' | 'info' | 'error' | 'success';
}) {
  const res = await Swal.fire({
    title: opts.title,
    text: opts.text,
    icon: opts.icon ?? 'warning',
    showCancelButton: true,
    confirmButtonText: opts.confirmText ?? 'Yes',
    cancelButtonText: opts.cancelText ?? 'Cancel',
    confirmButtonColor: '#B91C1C',
  });
  return res.isConfirmed;
}

export async function successDialog(title: string, text?: string) {
  await Swal.fire({
    title,
    text,
    icon: 'success',
    confirmButtonText: 'OK',
    confirmButtonColor: '#B91C1C',
  });
}

export async function errorDialog(title: string, text?: string) {
  await Swal.fire({
    title,
    text,
    icon: 'error',
    confirmButtonText: 'OK',
    confirmButtonColor: '#B91C1C',
  });
}

