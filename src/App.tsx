import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { BottomNav } from './components/BottomNav';
import { Header } from './components/Header';
import { TickerTape } from './components/TickerTape';
import { AuthProvider } from './hooks/useAuth';
import { AuthModalProvider } from './hooks/useAuthModal';
import { DepositModalProvider } from './hooks/useDepositModal';
import { ToastProvider } from './hooks/useToast';
import { WalletProvider } from './hooks/useWallet';
import Admin from './pages/Admin';
import CreateMarket from './pages/CreateMarket';
import Home from './pages/Home';
import Leaderboard from './pages/Leaderboard';
import MarketDetail from './pages/MarketDetail';
import NotFound from './pages/NotFound';
import Portfolio from './pages/Portfolio';
import Search from './pages/Search';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScrollToTop />
        <AuthProvider>
          <ToastProvider>
            <AuthModalProvider>
              <WalletProvider>
                <DepositModalProvider>
                  <div className="flex min-h-screen flex-col bg-bg text-text-primary">
                    <Header />
                    <TickerTape />
                    <main className="flex-1 pb-16 sm:pb-0">
                      <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/search" element={<Search />} />
                        <Route path="/leaderboard" element={<Leaderboard />} />
                        <Route path="/market/:slug" element={<MarketDetail />} />
                        <Route path="/portfolio" element={<Portfolio />} />
                        <Route path="/create" element={<CreateMarket />} />
                        <Route path="/admin" element={<Admin />} />
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </main>
                    <BottomNav />
                  </div>
                </DepositModalProvider>
              </WalletProvider>
            </AuthModalProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
