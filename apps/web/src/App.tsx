import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ChatPage } from "./pages/ChatPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ReaderDetailPage } from "./pages/ReaderDetailPage";
import { ReaderPage } from "./pages/ReaderPage";
import { ScenariosPage } from "./pages/ScenariosPage";
import { SettingsPage } from "./pages/SettingsPage";
import { VocabPage } from "./pages/VocabPage";
import { VoicePage } from "./pages/VoicePage";
import { SentencePracticePage } from "./pages/SentencePracticePage";
import { SpeakTranslatePage } from "./pages/SpeakTranslatePage";
import { ComingSoonPage } from "./pages/ComingSoonPage";
import { SubstitutionPage } from "./pages/SubstitutionPage";

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="vocab" element={<VocabPage />} />
            <Route path="vocab/practice" element={<SentencePracticePage />} />
            <Route path="vocab/drill" element={<SubstitutionPage />} />
            {/* Algoritma iyileştirmeleri / gereksiz özellikler için geçici kapatıldı — bkz. lib/disabledFeatures.ts */}
            <Route path="top-words" element={<ComingSoonPage feature="topWords" />} />
            <Route path="journal" element={<ComingSoonPage feature="journal" />} />
            <Route path="lyrics" element={<ComingSoonPage feature="lyrics" />} />
            <Route path="tenses" element={<ComingSoonPage feature="tenses" />} />
            <Route path="tenses/:id" element={<ComingSoonPage feature="tenses" />} />
            <Route path="speak" element={<SpeakTranslatePage />} />
            <Route path="reader" element={<ReaderPage />} />
            <Route path="reader/:id" element={<ReaderDetailPage />} />
            <Route path="scenarios" element={<ScenariosPage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="voice" element={<VoicePage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
