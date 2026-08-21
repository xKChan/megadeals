import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import AboutPage from "./pages/AboutPage";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";

/**
 * App.jsx — top-level route table only. Shared chrome (sticky header +
 * search/category pills on the home page, footer with affiliate disclosure
 * everywhere) lives in <Layout>; each route renders inside its <Outlet>.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="terms" element={<TermsPage />} />
      </Route>
    </Routes>
  );
}
