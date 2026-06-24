import apiClient from '../../utils/apiClient';

export const recipesService = {
  listRecipes: async (params?: { menu_item_id?: number; addon_id?: number; modifier_id?: number }) => {
    const res = await apiClient.get('/admin/recipes', { params });
    return res.data ?? [];
  },
  createRecipe: async (data: {
    menu_item_id?: number | null;
    variant_id?: number | null;
    addon_id?: number | null;
    modifier_id?: number | null;
    notes?: string;
  }) => {
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
  updateLine: async (recipeId: number, lineId: number, data: {
    qty?: number;
    uom_id?: number;
    wastage_factor?: number | null;
    notes?: string | null;
  }) => {
    const res = await apiClient.patch(`/admin/recipes/${recipeId}/lines/${lineId}`, data);
    return res.data;
  },
  deleteLine: async (recipeId: number, lineId: number) => {
    const res = await apiClient.delete(`/admin/recipes/${recipeId}/lines/${lineId}`);
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

