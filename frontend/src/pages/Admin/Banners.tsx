import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { Banner } from '../../types';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { confirmDialog } from '../../utils/sweetAlert';

const emptyForm = {
  title: '',
  subtitle: '',
  image_url: '',
  is_active: true,
};

const Banners: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [imageUploading, setImageUploading] = useState(false);

  const { data: banners, isLoading } = useQuery({
    queryKey: ['banners'],
    queryFn: adminService.getBanners,
  });

  const bannerList = banners ?? [];
  const paginated = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return bannerList.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [bannerList, page]);

  const createMutation = useMutation({
    mutationFn: adminService.createBanner,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banners'] });
      setShowForm(false);
      setFormData({ ...emptyForm });
      toast.success('Banner created successfully!');
    },
    onError: (error: { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message || 'Failed to create banner');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Banner> }) =>
      adminService.updateBanner(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banners'] });
      setShowForm(false);
      setEditingBanner(null);
      setFormData({ ...emptyForm });
      toast.success('Banner updated successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update banner');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: adminService.deleteBanner,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banners'] });
      toast.success('Banner deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete banner');
    },
  });

  const handleEdit = (banner: Banner) => {
    setEditingBanner(banner);
    setFormData({
      title: banner.title,
      subtitle: banner.subtitle ?? '',
      image_url: banner.image_url,
      is_active: banner.is_active,
    });
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Partial<Banner> = {
      title: formData.title,
      subtitle: formData.subtitle || null,
      image_url: formData.image_url,
      is_active: formData.is_active,
      valid_from: null,
      valid_until: null,
    };
    if (editingBanner) {
      updateMutation.mutate({ id: editingBanner.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const uploadImage = async (file: File) => {
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('folder', 'banners');
      const { data } = await apiClient.post<{ url: string }>('/admin/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!data?.url?.trim()) throw new Error('Upload did not return a URL');
      setFormData((prev) => ({ ...prev, image_url: data.url }));
      toast.success('Image uploaded');
    } catch {
      toast.error('Image upload failed');
    } finally {
      setImageUploading(false);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading banners...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-800">CMS Banners</h1>
        <Button onClick={() => { setEditingBanner(null); setFormData({ ...emptyForm }); setShowForm(true); }}>
          Add Banner
        </Button>
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingBanner(null); }}
        title={editingBanner ? 'Edit Banner' : 'Create Banner'}
        size="large"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subtitle</label>
            <input
              type="text"
              value={formData.subtitle}
              onChange={(e) => setFormData({ ...formData, subtitle: e.target.value })}
              placeholder="Optional tagline below the title"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Banner Image *</label>
            <div className="flex items-center gap-3">
              {formData.image_url && (
                <img
                  src={formData.image_url}
                  alt="Banner preview"
                  className="h-16 w-28 object-cover rounded-md border border-gray-200"
                />
              )}
              <div className="flex flex-col gap-1">
                <input
                  type="file"
                  accept="image/*"
                  id="banner-image-upload"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadImage(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="small"
                  isLoading={imageUploading}
                  onClick={() => document.getElementById('banner-image-upload')?.click()}
                >
                  {formData.image_url ? 'Change Image' : 'Upload Image'}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="banner_active"
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="h-4 w-4 text-blue-600 border-gray-300 rounded"
            />
            <label htmlFor="banner_active" className="ml-2 text-sm text-gray-700">Active</label>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingBanner(null); }}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>
              {editingBanner ? 'Update' : 'Create'} Banner
            </Button>
          </div>
        </form>
      </Modal>

      <div className="w-full space-y-3">
        {bannerList.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">
              No banners yet. Create your first banner for the mobile app home screen.
            </p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginated.map((banner, i) => (
                <AccentedListRow
                  key={banner.id}
                  accent={banner.is_active ? 'active' : 'inactive'}
                  imageUrl={banner.image_url}
                  initial={banner.title.charAt(0)}
                  title={banner.title}
                  subtitle={
                    <>
                      {banner.subtitle && <p className="text-gray-500">{banner.subtitle}</p>}
                    </>
                  }
                  statusLabel={banner.is_active ? 'Active' : 'Inactive'}
                  statusVariant={banner.is_active ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      <Button size="small" variant="edit" onClick={() => handleEdit(banner)}>Edit</Button>
                      <Button
                        size="small"
                        variant={banner.is_active ? 'outline' : 'primary'}
                        isLoading={updateMutation.isPending}
                        onClick={() => updateMutation.mutate({ id: banner.id, data: { is_active: !banner.is_active } })}
                      >
                        {banner.is_active ? 'Set inactive' : 'Set active'}
                      </Button>
                      <Button
                        size="small"
                        variant="danger"
                        isLoading={deleteMutation.isPending}
                        onClick={() => {
                          (async () => {
                            const ok = await confirmDialog({
                              title: `Delete banner "${banner.title}"?`,
                              text: 'This action cannot be undone.',
                              confirmText: 'Delete',
                            });
                            if (!ok) return;
                            deleteMutation.mutate(banner.id);
                          })();
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar totalCount={bannerList.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="banners" />
          </>
        )}
      </div>
    </div>
  );
};

export default Banners;
