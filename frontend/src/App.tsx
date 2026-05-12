import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './components/AdminLayout';
import { ModelConfigPage } from './routes/ModelConfigPage';
import { ProjectsPage } from './routes/ProjectsPage';
import { ReviewExportPage } from './routes/ReviewExportPage';
import { UploadPage } from './routes/UploadPage';
import { ImageGenerationPage } from './routes/ImageGenerationPage';
import { WorkspacePage } from './routes/WorkspacePage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AdminLayout />}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/new" element={<UploadPage />} />
        <Route path="settings/model" element={<ModelConfigPage />} />
        <Route path="workspace/:projectId" element={<WorkspacePage />} />
        <Route path="workspace/:projectId/images" element={<ImageGenerationPage />} />
        <Route path="review/:projectId" element={<ReviewExportPage />} />
      </Route>
      <Route path="/model-config" element={<Navigate to="/settings/model" replace />} />
      <Route path="/upload" element={<Navigate to="/projects/new" replace />} />
    </Routes>
  );
}
