/**
 * The built-in feed lists offered to people without feeds: hand-picked, well-known sources grouped by interest.
 * This is the single place to maintain them; the web app and the native apps read them through `GET /api/v1/feed-lists`.
 *
 * Rules for entries:
 * - `title` is the name of the site alone ("The Verge", not "The Verge – tech news and reviews").
 * - `description` is one short line in every language saying what the site shows, not what it is called.
 * - Every address was checked to serve a feed. A feed belongs to one list only.
 * - `lang` is the language of the feed's content (`de`, `en`, `ja`).
 */
export interface Localized {
  en: string;
  de: string;
  ja: string;
  ru: string;
}

export interface FeedListFeedData {
  title: string;
  url: string;
  lang: "de" | "en" | "ja" | "ru";
  description: Localized;
}

export interface FeedListData {
  id: string;
  /** Name of an SF Symbol; shown next to the list and used as the icon of the folder it creates. */
  iconSymbol: string;
  title: Localized;
  description: Localized;
  feeds: FeedListFeedData[];
}

export const BUILT_IN_FEED_LISTS: FeedListData[] = [
  {
    id: "news",
    iconSymbol: "newspaper",
    title: { en: "News", de: "Nachrichten", ja:, ru: "Новости" "ニュース" },
    description: { en: "Headlines from public broadcasters and newspapers.", de: "Schlagzeilen von öffentlich-rechtlichen Sendern und Zeitungen.", ja:, ru: "Заголовки от государственных СМИ и газет." "放送局や新聞社の主要ニュース。" },
    feeds: [
      { title: "Tagesschau", url: "https://www.tagesschau.de/index~rss2.xml", lang: "de", description: { en: "Germany's main evening news and its latest reports.", de: "Die aktuellen Meldungen der Tagesschau.", ja:, ru: "Главные вечерние новости и последние репортажи Германии." "ドイツの公共放送ARDの最新ニュース。" } },
      { title: "Deutschlandfunk", url: "https://www.deutschlandfunk.de/nachrichten-100.rss", lang: "de", description: { en: "News bulletins from the national radio station.", de: "Nachrichten des Informationsradios.", ja:, ru: "Новостные выпуски национального радио." "ドイツの国営ラジオ局のニュース速報。" } },
      { title: "ZEIT ONLINE", url: "https://newsfeed.zeit.de/index", lang: "de", description: { en: "Politics, society and background from the weekly paper.", de: "Politik, Gesellschaft und Hintergründe der Wochenzeitung.", ja:, ru: "Политика, общество и аналитика из еженедельника." "週刊紙による政治・社会・解説記事。" } },
      { title: "DER SPIEGEL", url: "https://www.spiegel.de/schlagzeilen/index.rss", lang: "de", description: { en: "Headlines from the news magazine.", de: "Schlagzeilen des Nachrichtenmagazins.", ja:, ru: "Заголовки из новостного журнала." "ニュース雑誌の最新ヘッドライン。" } },
      { title: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", lang: "en", description: { en: "Top stories from around the world.", de: "Die wichtigsten Meldungen aus aller Welt.", ja:, ru: "Главное со всего мира." "世界各地の主要ニュース。" } },
      { title: "The Guardian", url: "https://www.theguardian.com/world/rss", lang: "en", description: { en: "International reporting from the British daily.", de: "Internationale Berichte der britischen Tageszeitung.", ja:, ru: "Международная журналистика британской газеты." "英国の日刊紙による国際報道。" } },
      { title: "NPR News", url: "https://feeds.npr.org/1001/rss.xml", lang: "en", description: { en: "US news from public radio.", de: "Nachrichten aus den USA vom öffentlichen Radio.", ja:, ru: "Новости США от общественного радио." "米国の公共ラジオによるニュース。" } },
      { title: "NHK", url: "https://www.nhk.or.jp/rss/news/cat0.xml", lang: "ja", description: { en: "Main news from Japan's public broadcaster.", de: "Hauptnachrichten des japanischen Rundfunks.", ja:, ru: "Главные новости от японского государственного вещателя." "NHKの主要ニュース。" } },
    ],
  },
  {
    id: "technology",
    iconSymbol: "desktopcomputer",
    title: { en: "Technology", de: "Technik", ja:, ru: "Технологии" "テクノロジー" },
    description: { en: "News and background on software, hardware and the web.", de: "Nachrichten und Hintergründe zu Software, Hardware und Netz.", ja:, ru: "Новости и аналитика о ПО, железе и вебе." "ソフトウェア、ハードウェア、ウェブのニュースと解説。" },
    feeds: [
      { title: "heise online", url: "https://www.heise.de/rss/heise-atom.xml", lang: "de", description: { en: "IT news and tests from Germany's best-known tech publisher.", de: "IT-Nachrichten und Tests des bekannten Technikverlags.", ja:, ru: "IT-новости и тесты от известного немецкого издателя." "ドイツを代表するIT媒体のニュースとレビュー。" } },
      { title: "Golem.de", url: "https://www.golem.de/rss.php?feed=RSS2.0", lang: "de", description: { en: "IT and technology news for professionals and enthusiasts.", de: "IT- und Technikmeldungen für Profis und Technikfans.", ja:, ru: "IT и техно-новости для профессионалов и энтузиастов." "専門家と愛好家向けのIT・テクノロジーニュース。" } },
      { title: "netzpolitik.org", url: "https://netzpolitik.org/feed/", lang: "de", description: { en: "Digital rights, privacy and internet policy.", de: "Digitale Freiheitsrechte, Datenschutz und Netzpolitik.", ja:, ru: "Цифровые права, приватность и интернет-политика." "デジタルの権利、プライバシー、ネット政策。" } },
      { title: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", lang: "en", description: { en: "In-depth technology reporting and analysis.", de: "Ausführliche Technikberichte und Analysen.", ja:, ru: "Глубокая техно-журналистика и аналитика." "技術分野の詳しい報道と分析。" } },
      { title: "The Verge", url: "https://www.theverge.com/rss/index.xml", lang: "en", description: { en: "Gadgets, tech and how they change culture.", de: "Geräte, Technik und ihr Einfluss auf die Kultur.", ja:, ru: "Гаджеты, технологии и их влияние на культуру." "ガジェットとテクノロジー、その文化への影響。" } },
      { title: "ITmedia", url: "https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml", lang: "ja", description: { en: "IT news from Japan across all topics.", de: "IT-Nachrichten aus Japan zu allen Themen.", ja:, ru: "IT-новости из Японии по всем темам." "ITmediaの全分野の最新ニュース。" } },
      { title: "GIGAZINE", url: "https://gigazine.net/news/rss_2.0/", lang: "ja", description: { en: "Quirky tech, gadgets and internet culture.", de: "Technik, Gadgets und Netzkultur mit Augenzwinkern.", ja:, ru: "Необычные технологии, гаджеты и интернет-культура." "ITやガジェット、ネット文化の話題。" } },
      { title: "ギズモード", url: "https://www.gizmodo.jp/index.xml", lang: "ja", description: { en: "Gadgets and science news in Japanese.", de: "Gadgets und Wissenschaft auf Japanisch.", ja:, ru: "Новости гаджетов и науки на японском." "ガジェットと科学の最新情報。" } },
    ],
  },
  {
    id: "apple",
    iconSymbol: "macbook.and.iphone",
    title: { en: "Apple", de: "Apple", ja:, ru: "Apple" "Apple" },
    description: { en: "iPhone, Mac and everything around them.", de: "iPhone, Mac und alles drumherum.", ja:, ru: "iPhone, Mac и всё вокруг них." "iPhone、Macとその周辺の話題。" },
    feeds: [
      { title: "iPhone-Ticker", url: "https://www.iphone-ticker.de/feed/", lang: "de", description: { en: "Daily news about iPhone, iPad and Mac.", de: "Tägliche Neuigkeiten zu iPhone, iPad und Mac.", ja:, ru: "Ежедневные новости об iPhone, iPad и Mac." "iPhone、iPad、Macの毎日のニュース。" } },
      { title: "ifun.de", url: "https://www.ifun.de/feed/", lang: "de", description: { en: "iPhone news and app tips.", de: "iPhone-News und App-Tipps.", ja:, ru: "Новости iPhone и советы по приложениям." "iPhoneのニュースとアプリのヒント。" } },
      { title: "MacTechNews", url: "https://www.mactechnews.de/Rss/News.x", lang: "de", description: { en: "Apple news with a technical focus.", de: "Apple-Nachrichten mit technischem Schwerpunkt.", ja:, ru: "Новости Apple с техническим уклоном." "技術寄りのAppleニュース。" } },
      { title: "Daring Fireball", url: "https://daringfireball.net/feeds/main", lang: "en", description: { en: "John Gruber's commentary on Apple and design.", de: "John Grubers Kommentare zu Apple und Design.", ja:, ru: "Комментарии Джона Грубера о Apple и дизайне." "ジョン・グルーバーによるAppleとデザインの論評。" } },
      { title: "MacStories", url: "https://www.macstories.net/feed/", lang: "en", description: { en: "Apps, workflows and in-depth reviews.", de: "Apps, Workflows und ausführliche Tests.", ja:, ru: "Приложения, рабочие процессы и глубокие обзоры." "アプリ、ワークフロー、詳しいレビュー。" } },
      { title: "MacRumors", url: "https://feeds.macrumors.com/MacRumors-All", lang: "en", description: { en: "Rumors and news about upcoming Apple products.", de: "Gerüchte und News zu kommenden Apple-Produkten.", ja:, ru: "Слухи и новости о будущих продуктах Apple." "Apple新製品の噂とニュース。" } },
      { title: "9to5Mac", url: "https://9to5mac.com/feed/", lang: "en", description: { en: "Apple news, reviews and software updates.", de: "Apple-News, Tests und Software-Updates.", ja:, ru: "Новости Apple, обзоры и обновления ПО." "Appleのニュース、レビュー、アップデート情報。" } },
      { title: "iPhone Mania", url: "https://iphone-mania.jp/feed/", lang: "ja", description: { en: "iPhone news and tips in Japanese.", de: "iPhone-News und Tipps auf Japanisch.", ja:, ru: "Новости iPhone и советы на японском." "iPhoneのニュースと使い方のヒント。" } },
    ],
  },
  {
    id: "development",
    iconSymbol: "chevron.left.forwardslash.chevron.right",
    title: { en: "Development", de: "Entwicklung", ja:, ru: "Разработка" "開発" },
    description: { en: "Programming, tools and craft for developers.", de: "Programmierung, Werkzeuge und Handwerk für Entwickler.", ja:, ru: "Программирование, инструменты и ремесло для разработчиков." "プログラミング、ツール、開発の技術。" },
    feeds: [
      { title: "heise Developer", url: "https://www.heise.de/developer/rss/news-atom.xml", lang: "de", description: { en: "News for software developers in German.", de: "Nachrichten für Softwareentwickler.", ja:, ru: "Новости для разработчиков на немецком." "ソフトウェア開発者向けドイツ語ニュース。" } },
      { title: "GitHub Blog", url: "https://github.blog/feed/", lang: "en", description: { en: "Product news and engineering stories from GitHub.", de: "Produktneuheiten und Entwicklerberichte von GitHub.", ja:, ru: "Новости продуктов и инженерные истории от GitHub." "GitHubの製品情報と開発の話題。" } },
      { title: "Stack Overflow Blog", url: "https://stackoverflow.blog/feed/", lang: "en", description: { en: "Essays on software and the people who build it.", de: "Beiträge über Software und die Menschen dahinter.", ja:, ru: "Эссе о софте и людях, которые его создают." "ソフトウェアとそれを作る人々についての記事。" } },
      { title: "CSS-Tricks", url: "https://css-tricks.com/feed/", lang: "en", description: { en: "Tutorials and tips for CSS and front-end work.", de: "Anleitungen und Tipps zu CSS und Frontend.", ja:, ru: "Туториалы и советы по CSS и фронтенду." "CSSとフロントエンドのチュートリアルとヒント。" } },
      { title: "Swift by Sundell", url: "https://www.swiftbysundell.com/rss", lang: "en", description: { en: "Articles and tips on Swift and app development.", de: "Artikel und Tipps zu Swift und App-Entwicklung.", ja:, ru: "Статьи и советы по Swift и разработке приложений." "Swiftとアプリ開発の記事とヒント。" } },
      { title: "Publickey", url: "https://www.publickey1.jp/atom.xml", lang: "ja", description: { en: "Enterprise IT and cloud news from Japan.", de: "Unternehmens-IT und Cloud-News aus Japan.", ja:, ru: "Корпоративный IT и облачные новости из Японии." "企業ITとクラウドの最新動向。" } },
      { title: "Qiita", url: "https://qiita.com/popular-items/feed", lang: "ja", description: { en: "Popular programming posts from Japanese developers.", de: "Beliebte Programmierbeiträge japanischer Entwickler.", ja:, ru: "Популярные посты о программировании от японских разработчиков." "開発者に人気のプログラミング記事。" } },
      { title: "Zenn", url: "https://zenn.dev/feed", lang: "ja", description: { en: "Technical articles and books by developers.", de: "Technische Artikel und Bücher von Entwicklern.", ja:, ru: "Технические статьи и книги от разработчиков." "開発者による技術記事と本。" } },
    ],
  },
  {
    id: "science",
    iconSymbol: "atom",
    title: { en: "Science", de: "Wissenschaft", ja:, ru: "Наука" "科学" },
    description: { en: "Research, space and nature.", de: "Forschung, Weltraum und Natur.", ja:, ru: "Исследования, космос и природа." "研究、宇宙、自然。" },
    feeds: [
      { title: "Spektrum", url: "https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406", lang: "de", description: { en: "Science news and explanations from a leading magazine.", de: "Wissenschaftsnachrichten und Erklärungen aus dem Magazin.", ja:, ru: "Новости науки и объяснения от ведущего журнала." "科学誌によるニュースと解説。" } },
      { title: "scinexx", url: "https://www.scinexx.de/feed/", lang: "de", description: { en: "Findings from research, explained for everyone.", de: "Forschungsergebnisse, verständlich erklärt.", ja:, ru: "Научные открытия, объяснённые для каждого." "研究成果をわかりやすく解説。" } },
      { title: "Quanta Magazine", url: "https://www.quantamagazine.org/feed/", lang: "en", description: { en: "Mathematics, physics and biology in depth.", de: "Mathematik, Physik und Biologie in der Tiefe.", ja:, ru: "Глубокие статьи о математике, физике и биологии." "数学、物理、生物学を深く掘り下げる。" } },
      { title: "NASA", url: "https://www.nasa.gov/feed/", lang: "en", description: { en: "Missions and discoveries straight from NASA.", de: "Missionen und Entdeckungen direkt von der NASA.", ja:, ru: "Миссии и открытия прямо от NASA." "NASAの探査とその成果。" } },
      { title: "Nature", url: "https://www.nature.com/nature.rss", lang: "en", description: { en: "New papers from the leading science journal.", de: "Neue Studien aus der führenden Fachzeitschrift.", ja:, ru: "Новые статьи от ведущего научного журнала." "主要科学誌の最新論文。" } },
      { title: "ScienceDaily", url: "https://www.sciencedaily.com/rss/all.xml", lang: "en", description: { en: "Short summaries of new research in every field.", de: "Kurze Zusammenfassungen neuer Forschung aller Fächer.", ja:, ru: "Краткие сводки новых исследований по всем областям." "あらゆる分野の最新研究の要約。" } },
      { title: "sorae", url: "https://sorae.info/feed", lang: "ja", description: { en: "Space news and rocket launches.", de: "Raumfahrt-Nachrichten und Raketenstarts.", ja:, ru: "Новости о космосе и запусках ракет." "宇宙ニュースとロケット打ち上げ情報。" } },
      { title: "ナゾロジー", url: "https://nazology.kusuguru.co.jp/feed", lang: "ja", description: { en: "Curious science stories in plain language.", de: "Erstaunliche Wissenschaftsgeschichten, leicht erzählt.", ja:, ru: "Удивительные научные факты простым языком." "身近な科学の不思議をやさしく紹介。" } },
      { title: "日経サイエンス", url: "https://www.nikkei-science.com/?feed=rss2", lang: "ja", description: { en: "Japanese edition of Scientific American.", de: "Die japanische Ausgabe von Scientific American.", ja:, ru: "Японское издание Scientific American." "Scientific American日本版。" } },
    ],
  },
  {
    id: "design",
    iconSymbol: "paintpalette",
    title: { en: "Design", de: "Design", ja:, ru: "Дизайн" "デザイン" },
    description: { en: "Web design, interfaces and creative work.", de: "Webdesign, Oberflächen und kreative Arbeit.", ja:, ru: "Веб-дизайн, интерфейсы и творческая работа." "ウェブデザイン、UI、クリエイティブ。" },
    feeds: [
      { title: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/", lang: "en", description: { en: "Practical guides for designers and front-end developers.", de: "Praxisnahe Anleitungen für Designer und Frontend-Entwickler.", ja:, ru: "Практические руководства для дизайнеров и фронтендеров." "デザイナーとフロントエンド開発者向けの実践ガイド。" } },
      { title: "UX Collective", url: "https://uxdesign.cc/feed", lang: "en", description: { en: "Stories on user experience and product design.", de: "Beiträge zu User Experience und Produktdesign.", ja:, ru: "Истории о пользовательском опыте и дизайне продуктов." "UXとプロダクトデザインの記事。" } },
      { title: "Creative Bloq", url: "https://www.creativebloq.com/feeds/all", lang: "en", description: { en: "Inspiration, tutorials and tools for creatives.", de: "Inspiration, Tutorials und Werkzeuge für Kreative.", ja:, ru: "Вдохновение, туториалы и инструменты для креативщиков." "クリエイター向けのインスピレーションとチュートリアル。" } },
      { title: "designboom", url: "https://www.designboom.com/feed/", lang: "en", description: { en: "Architecture, art and product design from around the world.", de: "Architektur, Kunst und Produktdesign aus aller Welt.", ja:, ru: "Архитектура, искусство и дизайн продуктов со всего мира." "世界の建築、アート、プロダクトデザイン。" } },
      { title: "コリス", url: "https://coliss.com/feed/", lang: "ja", description: { en: "Web design and CSS news in Japanese.", de: "Webdesign- und CSS-Neuigkeiten auf Japanisch.", ja:, ru: "Веб-дизайн и CSS-новости на японском." "ウェブデザインとCSSの最新情報。" } },
      { title: "AXIS", url: "https://www.axismag.jp/feed", lang: "ja", description: { en: "Design magazine covering products and spaces.", de: "Designmagazin zu Produkten und Räumen.", ja:, ru: "Дизайн-журнал о продуктах и пространствах." "プロダクトと空間を扱うデザイン誌。" } },
      { title: "Web Creator Box", url: "https://www.webcreatorbox.com/feed", lang: "ja", description: { en: "Learning material for web creators.", de: "Lernmaterial für Webgestalter.", ja:, ru: "Обучающие материалы для веб-креативщиков." "ウェブクリエイター向けの学習コンテンツ。" } },
    ],
  },
  {
    id: "gaming",
    iconSymbol: "gamecontroller",
    title: { en: "Gaming", de: "Spiele", ja:, ru: "Игры" "ゲーム" },
    description: { en: "News, reviews and culture around video games.", de: "Nachrichten, Tests und Kultur rund um Videospiele.", ja:, ru: "Новости, обзоры и культура видеоигр." "ゲームのニュース、レビュー、カルチャー。" },
    feeds: [
      { title: "GameStar", url: "https://www.gamestar.de/news/rss/news.rss", lang: "de", description: { en: "PC and console game news from Germany.", de: "Neuigkeiten zu PC- und Konsolenspielen.", ja:, ru: "Новости PC и консольных игр из Германии." "PC・コンソールゲームのドイツ語ニュース。" } },
      { title: "PC Games", url: "https://www.pcgames.de/feed.cfm?menu_alias=home/", lang: "de", description: { en: "PC gaming news, previews and tests.", de: "PC-Spiele-News, Vorschauen und Tests.", ja:, ru: "Новости, превью и тесты PC-игр." "PCゲームのニュースとレビュー。" } },
      { title: "Eurogamer", url: "https://www.eurogamer.net/feed", lang: "en", description: { en: "Reviews and features on games of every kind.", de: "Tests und Reportagen zu Spielen aller Art.", ja:, ru: "Обзоры и статьи обо всех видах игр." "あらゆるゲームのレビューと特集。" } },
      { title: "Polygon", url: "https://www.polygon.com/rss/index.xml", lang: "en", description: { en: "Games, their makers and their communities.", de: "Spiele, ihre Macher und ihre Communities.", ja:, ru: "Игры, их создатели и сообщества." "ゲームとその作り手、コミュニティ。" } },
      { title: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/feed", lang: "en", description: { en: "PC gaming with a sharp, personal voice.", de: "PC-Spiele mit pointierter, persönlicher Stimme.", ja:, ru: "PC-игры с острым, личным взглядом." "個性的な視点で語るPCゲーム媒体。" } },
      { title: "4Gamer.net", url: "https://www.4gamer.net/rss/index.xml", lang: "ja", description: { en: "Japan's PC and online game news.", de: "PC- und Online-Spiele-News aus Japan.", ja:, ru: "Новости PC и онлайн-игр из Японии." "PC・オンラインゲームの最新情報。" } },
      { title: "AUTOMATON", url: "https://automaton-media.com/feed/", lang: "ja", description: { en: "Game news and interviews from Japan.", de: "Spiele-News und Interviews aus Japan.", ja:, ru: "Новости об играх и интервью из Японии." "ゲームのニュースとインタビュー。" } },
    ],
  },
  {
    id: "business",
    iconSymbol: "chart.line.uptrend.xyaxis",
    title: { en: "Business", de: "Wirtschaft", ja:, ru: "Бизнес" "経済" },
    description: { en: "Markets, companies and the economy.", de: "Märkte, Unternehmen und Konjunktur.", ja:, ru: "Рынки, компании и экономика." "市場、企業、経済。" },
    feeds: [
      { title: "Tagesschau Wirtschaft", url: "https://www.tagesschau.de/wirtschaft/index~rss2.xml", lang: "de", description: { en: "Economy news from public television.", de: "Wirtschaftsnachrichten des öffentlich-rechtlichen Fernsehens.", ja:, ru: "Экономические новости от государственного ТВ." "公共放送による経済ニュース。" } },
      { title: "Handelsblatt", url: "https://www.handelsblatt.com/contentexport/feed/top-themen", lang: "de", description: { en: "Top stories on business, finance and politics.", de: "Top-Themen zu Wirtschaft, Finanzen und Politik.", ja:, ru: "Главные темы о бизнесе, финансах и политике." "経済・金融・政治の主要記事。" } },
      { title: "ZEIT Wirtschaft", url: "https://newsfeed.zeit.de/wirtschaft/index", lang: "de", description: { en: "Economic analysis from the weekly paper.", de: "Wirtschaftsanalysen aus der Wochenzeitung.", ja:, ru: "Экономический анализ из еженедельника." "週刊紙による経済分析。" } },
      { title: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", lang: "en", description: { en: "Business and economy news from the BBC.", de: "Wirtschaftsnachrichten der BBC.", ja:, ru: "Новости бизнеса и экономики от BBC." "BBCの経済ニュース。" } },
      { title: "The Economist", url: "https://www.economist.com/finance-and-economics/rss.xml", lang: "en", description: { en: "Finance and economics in the weekly's own analysis.", de: "Finanzen und Wirtschaft in der Analyse des Wochenmagazins.", ja:, ru: "Финансы и экономика в анализе еженедельника." "週刊誌による金融・経済の分析。" } },
      { title: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", lang: "en", description: { en: "Markets and company news from the US.", de: "Märkte und Unternehmensnachrichten aus den USA.", ja:, ru: "Новости рынков и компаний из США." "米国の市場と企業のニュース。" } },
      { title: "東洋経済オンライン", url: "https://toyokeizai.net/list/feed/rss", lang: "ja", description: { en: "Business and economy articles from Japan.", de: "Wirtschaftsartikel aus Japan.", ja:, ru: "Статьи о бизнесе и экономике из Японии." "ビジネスと経済の話題。" } },
    ],
  },
  {
    id: "sport",
    iconSymbol: "sportscourt",
    title: { en: "Sport", de: "Sport", ja:, ru: "Спорт" "スポーツ" },
    description: { en: "Results, reports and background from the world of sport.", de: "Ergebnisse, Berichte und Hintergründe aus dem Sport.", ja:, ru: "Результаты, репортажи и аналитика из мира спорта." "試合結果、レポート、スポーツの背景。" },
    feeds: [
      { title: "Sportschau", url: "https://www.sportschau.de/index~rss2.xml", lang: "de", description: { en: "Sport news from public television.", de: "Sportnachrichten des öffentlich-rechtlichen Fernsehens.", ja:, ru: "Спортивные новости от государственного ТВ." "公共放送によるスポーツニュース。" } },
      { title: "Sportschau Fußball", url: "https://www.sportschau.de/fussball/index~rss2.xml", lang: "de", description: { en: "Football news, Bundesliga and more.", de: "Fußball-News, Bundesliga und mehr.", ja:, ru: "Новости футбола, Бундеслига и другое." "サッカーとブンデスリーガのニュース。" } },
      { title: "kicker", url: "https://newsfeed.kicker.de/news/aktuell", lang: "de", description: { en: "Football news and match reports.", de: "Fußball-Nachrichten und Spielberichte.", ja:, ru: "Новости футбола и отчёты о матчах." "サッカーのニュースと試合レポート。" } },
      { title: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml", lang: "en", description: { en: "Results and stories from every sport.", de: "Ergebnisse und Geschichten aus allen Sportarten.", ja:, ru: "Результаты и статьи из всех видов спорта." "あらゆる競技の結果と記事。" } },
      { title: "The Guardian Sport", url: "https://www.theguardian.com/sport/rss", lang: "en", description: { en: "Sport reporting and comment from the Guardian.", de: "Sportberichte und Kommentare des Guardian.", ja:, ru: "Спортивная журналистика и комментарии Guardian." "ガーディアン紙のスポーツ報道。" } },
    ],
  },
  {
    id: "culture",
    iconSymbol: "theatermasks",
    title: { en: "Culture", de: "Kultur", ja:, ru: "Культура" "カルチャー" },
    description: { en: "Film, music, books and art.", de: "Film, Musik, Bücher und Kunst.", ja:, ru: "Кино, музыка, книги и искусство." "映画、音楽、本、アート。" },
    feeds: [
      { title: "Monopol", url: "https://www.monopol-magazin.de/rss.xml", lang: "de", description: { en: "Contemporary art and its market.", de: "Zeitgenössische Kunst und Kunstmarkt.", ja:, ru: "Современное искусство и арт-рынок." "現代アートとアート市場。" } },
      { title: "The Guardian Film", url: "https://www.theguardian.com/film/rss", lang: "en", description: { en: "Film reviews and cinema news.", de: "Filmkritiken und Kinonachrichten.", ja:, ru: "Кинокритика и новости кино." "映画レビューと映画館のニュース。" } },
      { title: "The Guardian Books", url: "https://www.theguardian.com/books/rss", lang: "en", description: { en: "Book reviews, authors and literary news.", de: "Buchkritiken, Autoren und Literaturnachrichten.", ja:, ru: "Книжные рецензии, авторы и литературные новости." "書評、作家、文学ニュース。" } },
      { title: "Pitchfork", url: "https://pitchfork.com/feed/feed-news/rss", lang: "en", description: { en: "Music news and album reviews.", de: "Musiknachrichten und Albumkritiken.", ja:, ru: "Музыкальные новости и рецензии на альбомы." "音楽ニュースとアルバムレビュー。" } },
      { title: "The Marginalian", url: "https://www.themarginalian.org/feed/", lang: "en", description: { en: "Essays on art, science and the examined life.", de: "Essays über Kunst, Wissenschaft und das Nachdenken.", ja:, ru: "Эссе об искусстве, науке и осмысленной жизни." "アートと科学、人生をめぐるエッセイ。" } },
      { title: "CINRA", url: "https://www.cinra.net/feed", lang: "ja", description: { en: "Art, music and culture in Japan.", de: "Kunst, Musik und Kultur aus Japan.", ja:, ru: "Искусство, музыка и культура в Японии." "アート、音楽、カルチャーの話題。" } },
    ],
  },
];
