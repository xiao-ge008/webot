import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Globe, FileText, Mail, Github } from 'lucide-react';

export function Footer() {
    const { t } = useTranslation();
    const location = useLocation();

    // 为保证沉浸感，全屏的聊天页面自动隐藏底部 Footer
    if (location.pathname.startsWith('/chat') || location.pathname.startsWith('/group-chat')) {
        return null;
    }

    return (
        <>
            {/* 底部占位，防止滚动到底部时内容被固定 Footer 遮挡 */}
            <div className="h-[72px] shrink-0 w-full" />
            <footer className="fixed bottom-0 left-0 right-0 w-full border-t border-border bg-background/80 backdrop-blur-xl py-4 z-40 shadow-[0_-8px_30px_rgba(0,0,0,0.04)]">
                <div className="max-w-6xl mx-auto px-8 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex flex-col md:flex-row items-center gap-2 text-sm text-muted-foreground font-medium">
                        <span className="font-bold whitespace-nowrap opacity-80">{t('footer.copyright')}</span>
                        <span className="hidden md:inline text-border">|</span>
                        <span className="text-[10px] font-black tracking-widest uppercase bg-primary/10 text-primary px-2.5 py-0.5 rounded-full">
                            {t('footer.version')}
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm">
                        <a href="#" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors font-bold text-xs uppercase tracking-wider group">
                            <Globe className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                            {t('footer.website')}
                        </a>
                        <a href="#" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors font-bold text-xs uppercase tracking-wider group">
                            <FileText className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
                            {t('footer.docs')}
                        </a>
                        <a href="mailto:hello@example.com" className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors font-bold text-xs uppercase tracking-wider group">
                            <Mail className="w-4 h-4 group-hover:scale-110 transition-transform" />
                            {t('footer.contact')}
                        </a>
                        <a href="#" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors font-bold text-xs uppercase tracking-wider group">
                            <Github className="w-4 h-4 group-hover:rotate-6 transition-transform" />
                            {t('footer.github')}
                        </a>
                    </div>
                </div>
            </footer>
        </>
    );
}
