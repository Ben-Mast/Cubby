import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { FurnitureEditorPage } from '../routes/FurnitureEditorPage'
import { FurniturePage } from '../routes/FurniturePage'
import { LoginPage } from '../routes/LoginPage'
import { NotFoundPage } from '../routes/NotFoundPage'
import { RoomPage } from '../routes/RoomPage'
import { SurfacesPage } from '../routes/SurfacesPage'
import { SurfaceEditorPage } from '../routes/SurfaceEditorPage'
import { LoginRoute, ProtectedRoutes } from '../features/auth/AuthRoutes'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/room" replace />} />
      <Route element={<LoginRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      <Route element={<ProtectedRoutes />}>
        <Route element={<AppShell />}>
          <Route path="/room" element={<RoomPage />} />
          <Route path="/furniture" element={<FurniturePage />} />
          <Route path="/furniture/new" element={<FurnitureEditorPage />} />
          <Route path="/furniture/:id/edit" element={<FurnitureEditorPage />} />
          <Route path="/surfaces" element={<SurfacesPage />} />
          <Route path="/surfaces/new" element={<SurfaceEditorPage />} />
          <Route path="/surfaces/:id/edit" element={<SurfaceEditorPage />} />
          <Route path="/settings" element={<Navigate to="/room" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
