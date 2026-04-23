import apiClient from '../../utils/apiClient';

export const recipesService = {
  listRecipes: async (params?: { menu_item_id?: number }) => {
    const res = await apiClient.get('/admin/recipes', { params });
    return res.data ?? [];
  },
  createRecipe: async (data: { menu_item_id: number; variant_id?: number | null; notes?: string }) => {
    const res = await apiClient.post('/admin/recipes', data);
    return res.data;
  },
  addLine: async (recipeId: number, data: {
    inventory_item_id: number;
    qty: number;
    uom_id: number;
    wastage_factor?: number | null;
    notes?: string | null;
  }) => {
    const res = await apiClient.post(`/admin/recipes/${recipeId}/lines`, data);
    return res.data;
  },
  activate: async (recipeId: number) => {
    const res = await apiClient.post(`/admin/recipes/${recipeId}/activate`);
    return res.data;
  },
  computeCost: async (recipeId: number, data: { branch_id: number }) => {
    const res = await apiClient.post(`/admin/recipes/${recipeId}/compute-cost`, data);
    return res.data;
  },
};

