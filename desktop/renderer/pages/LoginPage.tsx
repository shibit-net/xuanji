import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '../stores/authStore';
import { useConfigStore } from '../stores/configStore';
import { getDesktopLabel } from '../i18n';
import loginBg from '../assets/logos/b7aa923993c0b15b70c96f2edc3df0fc.png';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const savedAccounts = useAuthStore((s) => s.savedAccounts);
  const loadSavedAccounts = useAuthStore((s) => s.loadSavedAccounts);
  const removeAccount = useAuthStore((s) => s.removeAccount);

  useEffect(() => {
    loadSavedAccounts();
  }, [loadSavedAccounts]);

  useEffect(() => {
    if (savedAccounts.length > 0 && !email) {
      setEmail(savedAccounts[0].email);
    }
  }, [savedAccounts, email]);

  // 用户开始输入时清除之前的错误
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (error) clearError();
  };
  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (error) clearError();
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const language = useConfigStore((s) => s.settings.language as 'zh' | 'en');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!email || !password || isLoading) return;
    await login(email, password);
  };

  const handleSelectAccount = (accountEmail: string) => {
    setEmail(accountEmail);
    setShowDropdown(false);
  };

  const handleRemoveAccount = async (e: React.MouseEvent, accountEmail: string) => {
    e.stopPropagation();
    if (confirm(getDesktopLabel('login.remove_account_confirm', language).replace('{account}', accountEmail))) {
      await removeAccount(accountEmail);
    }
  };

  const formatLastLogin = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const locale = language === 'en' ? 'en-US' : 'zh-CN';
    if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
      return getDesktopLabel('login.last_login_today', language).replace('{time}', date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }));
    }
    if (diff < 48 * 60 * 60 * 1000) {
      return getDesktopLabel('login.last_login_yesterday', language).replace('{time}', date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }));
    }
    if (diff < 7 * 24 * 60 * 60 * 1000) {
      const days = [
        getDesktopLabel('login.day_sun', language),
        getDesktopLabel('login.day_mon', language),
        getDesktopLabel('login.day_tue', language),
        getDesktopLabel('login.day_wed', language),
        getDesktopLabel('login.day_thu', language),
        getDesktopLabel('login.day_fri', language),
        getDesktopLabel('login.day_sat', language),
      ];
      return days[date.getDay()] + ' ' + date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  };

  const displayName = (account: { nickname?: string; email: string }) => {
    return account.nickname || account.email.split('@')[0];
  };

  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center overflow-hidden">
      {/* 背景氛围光 */}
      <div className="fixed top-[-15%] left-[-5%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px]" />
      <div className="fixed bottom-[-15%] right-[-5%] w-[40%] h-[40%] rounded-full bg-accent/10 blur-[100px]" />

      <div className="relative w-full max-w-sm px-6">
        <Card className="shadow-glass-xl">
          <CardHeader className="text-center pt-10 pb-2">
            <div className="mx-auto mb-6 w-20 h-20 rounded-2xl bg-white/10 flex items-center justify-center overflow-hidden shadow-glass-sm">
              <img src={loginBg} alt="Xuanji" className="w-full h-full object-cover" />
            </div>
            <CardTitle className="text-2xl font-display font-semibold tracking-tight">
              {getDesktopLabel('login.welcome', language)}
            </CardTitle>
            <CardDescription className="text-sm mt-1.5">
              {getDesktopLabel('login.desc', language)}
            </CardDescription>
          </CardHeader>

          <CardContent className="px-8 pb-10 pt-2">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                  <p className="text-destructive text-xs font-medium">{error}</p>
                </div>
              )}

              <div className="relative" ref={dropdownRef}>
                <label className="block text-xs text-muted-foreground mb-2">{getDesktopLabel('login.email_label', language)}</label>
                <Input
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  onFocus={() => savedAccounts.length > 0 && setShowDropdown(true)}
                  placeholder={getDesktopLabel('login.email_placeholder', language)}
                  required
                  disabled={isLoading}
                />

                {showDropdown && savedAccounts.length > 0 && (
                  <div className="absolute z-20 w-full mt-1.5 bg-popover border border-border rounded-xl shadow-glass-lg overflow-hidden animate-in fade-in-0">
                    {savedAccounts.map((account, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-accent transition-colors border-b border-border/50 last:border-b-0"
                        onClick={() => handleSelectAccount(account.email)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center text-primary text-xs font-medium shrink-0">
                            {displayName(account).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm text-foreground truncate">
                              {displayName(account)}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {account.email}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {formatLastLogin(account.lastLogin)}
                          </span>
                          <button
                            type="button"
                            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                            onClick={(e) => handleRemoveAccount(e, account.email)}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-2">{getDesktopLabel('login.password_label', language)}</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={handlePasswordChange}
                    placeholder={getDesktopLabel('login.password_placeholder', language)}
                    required
                    disabled={isLoading}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground transition-colors"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isLoading}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                      {showPassword ? (
                        <>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </>
                      ) : (
                        <>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading || (!email || !password)}
                className="w-full h-10 rounded-xl font-medium text-sm active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {getDesktopLabel('login.logging_in', language)}
                  </>
                ) : getDesktopLabel('login.button', language)}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <a
                href="https://shibit.net/register"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary/60 hover:text-primary transition-colors underline underline-offset-2"
              >
                {getDesktopLabel('login.register', language)}
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
