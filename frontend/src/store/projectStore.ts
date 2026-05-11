import { create } from 'zustand';
import type { ProjectData } from '../types/api';

interface ProjectStore {
  project?: ProjectData;
  setProject: (project: ProjectData) => void;
  clearProject: () => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  setProject: (project) => set({ project }),
  clearProject: () => set({ project: undefined }),
}));
