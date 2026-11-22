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
    title: { en: "News", de: "Nachrichten", ja: "ニュース", ru: "Новости" },
    description: { en: "Headlines from public broadcasters and newspapers.", de: "Schlagzeilen von öffentlich-rechtlichen Sendern und Zeitungen.", ja: "放送局や新聞社の主要ニュース。", ru: "Заголовки от государственных СМИ и газет." },
    feeds: [
      { title: "Tagesschau", url: "https://www.tagesschau.de/index~rss2.xml", lang: "de", description: { en: "Germany's main evening news and its latest reports.", de: "Die aktuellen Meldungen der Tagesschau.", ja: "ドイツの公共放送ARDの最新ニュース。", ru: "Главные вечерние новости и последние репортажи Германии." } },
      { title: "Deutschlandfunk", url: "https://www.deutschlandfunk.de/nachrichten-100.rss", lang: "de", description: { en: "News bulletins from the national radio station.", de: "Nachrichten des Informationsradios.", ja: "ドイツの国営ラジオ局のニュース速報。", ru: "Новостные выпуски национального радио." } },
      { title: "ZEIT ONLINE", url: "https://newsfeed.zeit.de/index", lang: "de", description: { en: "Politics, society and background from the weekly paper.", de: "Politik, Gesellschaft und Hintergründe der Wochenzeitung.", ja: "週刊紙による政治・社会・解説記事。", ru: "Политика, общество и аналитика из еженедельника." } },
      { title: "DER SPIEGEL", url: "https://www.spiegel.de/schlagzeilen/index.rss", lang: "de", description: { en: "Headlines from the news magazine.", de: "Schlagzeilen des Nachrichtenmagazins.", ja: "ニュース雑誌の最新ヘッドライン。", ru: "Заголовки из новостного журнала." } },
      { title: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", lang: "en", description: { en: "Top stories from around the world.", de: "Die wichtigsten Meldungen aus aller Welt.", ja: "世界各地の主要ニュース。", ru: "Главное со всего мира." } },
      { title: "The Guardian", url: "https://www.theguardian.com/world/rss", lang: "en", description: { en: "International reporting from the British daily.", de: "Internationale Berichte der britischen Tageszeitung.", ja: "英国の日刊紙による国際報道。", ru: "Международная журналистика британской газеты." } },
      { title: "NPR News", url: "https://feeds.npr.org/1001/rss.xml", lang: "en", description: { en: "US news from public radio.", de: "Nachrichten aus den USA vom öffentlichen Radio.", ja: "米国の公共ラジオによるニュース。", ru: "Новости США от общественного радио." } },
      { title: "NHK", url: "https://www.nhk.or.jp/rss/news/cat0.xml", lang: "ja", description: { en: "Main news from Japan's public broadcaster.", de: "Hauptnachrichten des japanischen Rundfunks.", ja: "NHKの主要ニュース。", ru: "Главные новости от японского государственного вещателя." } },
    ],
  },
  {
    id: "technology",
    iconSymbol: "desktopcomputer",
    title: { en: "Technology", de: "Technik", ja: "テクノロジー", ru: "Технологии" },
    description: { en: "News and background on software, hardware and the web.", de: "Nachrichten und Hintergründe zu Software, Hardware und Netz.", ja: "ソフトウェア、ハードウェア、ウェブのニュースと解説。", ru: "Новости и аналитика о ПО, железе и вебе." },
    feeds: [
      { title: "heise online", url: "https://www.heise.de/rss/heise-atom.xml", lang: "de", description: { en: "IT news and tests from Germany's best-known tech publisher.", de: "IT-Nachrichten und Tests des bekannten Technikverlags.", ja: "ドイツを代表するIT媒体のニュースとレビュー。", ru: "IT-новости и тесты от известного немецкого издателя." } },
      { title: "Golem.de", url: "https://www.golem.de/rss.php?feed=RSS2.0", lang: "de", description: { en: "IT and technology news for professionals and enthusiasts.", de: "IT- und Technikmeldungen für Profis und Technikfans.", ja: "専門家と愛好家向けのIT・テクノロジーニュース。", ru: "IT и техно-новости для профессионалов и энтузиастов." } },
      { title: "netzpolitik.org", url: "https://netzpolitik.org/feed/", lang: "de", description: { en: "Digital rights, privacy and internet policy.", de: "Digitale Freiheitsrechte, Datenschutz und Netzpolitik.", ja: "デジタルの権利、プライバシー、ネット政策。", ru: "Цифровые права, приватность и интернет-политика." } },
      { title: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", lang: "en", description: { en: "In-depth technology reporting and analysis.", de: "Ausführliche Technikberichte und Analysen.", ja: "技術分野の詳しい報道と分析。", ru: "Глубокая техно-журналистика и аналитика." } },
      { title: "The Verge", url: "https://www.theverge.com/rss/index.xml", lang: "en", description: { en: "Gadgets, tech and how they change culture.", de: "Geräte, Technik und ihr Einfluss auf die Kultur.", ja: "ガジェットとテクノロジー、その文化への影響。", ru: "Гаджеты, технологии и их влияние на культуру." } },
      { title: "ITmedia", url: "https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml", lang: "ja", description: { en: "IT news from Japan across all topics.", de: "IT-Nachrichten aus Japan zu allen Themen.", ja: "ITmediaの全分野の最新ニュース。", ru: "IT-новости из Японии по всем темам." } },
      { title: "GIGAZINE", url: "https://gigazine.net/news/rss_2.0/", lang: "ja", description: { en: "Quirky tech, gadgets and internet culture.", de: "Technik, Gadgets und Netzkultur mit Augenzwinkern.", ja: "ITやガジェット、ネット文化の話題。", ru: "Необычные технологии, гаджеты и интернет-культура." } },
      { title: "ギズモード", url: "https://www.gizmodo.jp/index.xml", lang: "ja", description: { en: "Gadgets and science news in Japanese.", de: "Gadgets und Wissenschaft auf Japanisch.", ja: "ガジェットと科学の最新情報。", ru: "Новости гаджетов и науки на японском." } },
    ],
  },
  {
    id: "apple",
    iconSymbol: "macbook.and.iphone",
    title: { en: "Apple", de: "Apple", ja: "Apple", ru: "Apple" },
    description: { en: "iPhone, Mac and everything around them.", de: "iPhone, Mac und alles drumherum.", ja: "iPhone、Macとその周辺の話題。", ru: "iPhone, Mac и всё вокруг них." },
    feeds: [
      { title: "iPhone-Ticker", url: "https://www.iphone-ticker.de/feed/", lang: "de", description: { en: "Daily news about iPhone, iPad and Mac.", de: "Tägliche Neuigkeiten zu iPhone, iPad und Mac.", ja: "iPhone、iPad、Macの毎日のニュース。", ru: "Ежедневные новости об iPhone, iPad и Mac." } },
      { title: "ifun.de", url: "https://www.ifun.de/feed/", lang: "de", description: { en: "iPhone news and app tips.", de: "iPhone-News und App-Tipps.", ja: "iPhoneのニュースとアプリのヒント。", ru: "Новости iPhone и советы по приложениям." } },
      { title: "MacTechNews", url: "https://www.mactechnews.de/Rss/News.x", lang: "de", description: { en: "Apple news with a technical focus.", de: "Apple-Nachrichten mit technischem Schwerpunkt.", ja: "技術寄りのAppleニュース。", ru: "Новости Apple с техническим уклоном." } },
      { title: "Daring Fireball", url: "https://daringfireball.net/feeds/main", lang: "en", description: { en: "John Gruber's commentary on Apple and design.", de: "John Grubers Kommentare zu Apple und Design.", ja: "ジョン・グルーバーによるAppleとデザインの論評。", ru: "Комментарии Джона Грубера о Apple и дизайне." } },
      { title: "MacStories", url: "https://www.macstories.net/feed/", lang: "en", description: { en: "Apps, workflows and in-depth reviews.", de: "Apps, Workflows und ausführliche Tests.", ja: "アプリ、ワークフロー、詳しいレビュー。", ru: "Приложения, рабочие процессы и глубокие обзоры." } },
      { title: "MacRumors", url: "https://feeds.macrumors.com/MacRumors-All", lang: "en", description: { en: "Rumors and news about upcoming Apple products.", de: "Gerüchte und News zu kommenden Apple-Produkten.", ja: "Apple新製品の噂とニュース。", ru: "Слухи и новости о будущих продуктах Apple." } },
      { title: "9to5Mac", url: "https://9to5mac.com/feed/", lang: "en", description: { en: "Apple news, reviews and software updates.", de: "Apple-News, Tests und Software-Updates.", ja: "Appleのニュース、レビュー、アップデート情報。", ru: "Новости Apple, обзоры и обновления ПО." } },
      { title: "iPhone Mania", url: "https://iphone-mania.jp/feed/", lang: "ja", description: { en: "iPhone news and tips in Japanese.", de: "iPhone-News und Tipps auf Japanisch.", ja: "iPhoneのニュースと使い方のヒント。", ru: "Новости iPhone и советы на японском." } },
    ],
  },
  {
    id: "development",
    iconSymbol: "chevron.left.forwardslash.chevron.right",
    title: { en: "Development", de: "Entwicklung", ja: "開発", ru: "Разработка" },
    description: { en: "Programming, tools and craft for developers.", de: "Programmierung, Werkzeuge und Handwerk für Entwickler.", ja: "プログラミング、ツール、開発の技術。", ru: "Программирование, инструменты и ремесло для разработчиков." },
    feeds: [
      { title: "heise Developer", url: "https://www.heise.de/developer/rss/news-atom.xml", lang: "de", description: { en: "News for software developers in German.", de: "Nachrichten für Softwareentwickler.", ja: "ソフトウェア開発者向けドイツ語ニュース。", ru: "Новости для разработчиков на немецком." } },
      { title: "GitHub Blog", url: "https://github.blog/feed/", lang: "en", description: { en: "Product news and engineering stories from GitHub.", de: "Produktneuheiten und Entwicklerberichte von GitHub.", ja: "GitHubの製品情報と開発の話題。", ru: "Новости продуктов и инженерные истории от GitHub." } },
      { title: "Stack Overflow Blog", url: "https://stackoverflow.blog/feed/", lang: "en", description: { en: "Essays on software and the people who build it.", de: "Beiträge über Software und die Menschen dahinter.", ja: "ソフトウェアとそれを作る人々についての記事。", ru: "Эссе о софте и людях, которые его создают." } },
      { title: "CSS-Tricks", url: "https://css-tricks.com/feed/", lang: "en", description: { en: "Tutorials and tips for CSS and front-end work.", de: "Anleitungen und Tipps zu CSS und Frontend.", ja: "CSSとフロントエンドのチュートリアルとヒント。", ru: "Туториалы и советы по CSS и фронтенду." } },
      { title: "Swift by Sundell", url: "https://www.swiftbysundell.com/rss", lang: "en", description: { en: "Articles and tips on Swift and app development.", de: "Artikel und Tipps zu Swift und App-Entwicklung.", ja: "Swiftとアプリ開発の記事とヒント。", ru: "Статьи и советы по Swift и разработке приложений." } },
      { title: "Publickey", url: "https://www.publickey1.jp/atom.xml", lang: "ja", description: { en: "Enterprise IT and cloud news from Japan.", de: "Unternehmens-IT und Cloud-News aus Japan.", ja: "企業ITとクラウドの最新動向。", ru: "Корпоративный IT и облачные новости из Японии." } },
      { title: "Qiita", url: "https://qiita.com/popular-items/feed", lang: "ja", description: { en: "Popular programming posts from Japanese developers.", de: "Beliebte Programmierbeiträge japanischer Entwickler.", ja: "開発者に人気のプログラミング記事。", ru: "Популярные посты о программировании от японских разработчиков." } },
      { title: "Zenn", url: "https://zenn.dev/feed", lang: "ja", description: { en: "Technical articles and books by developers.", de: "Technische Artikel und Bücher von Entwicklern.", ja: "開発者による技術記事と本。", ru: "Технические статьи и книги от разработчиков." } },
    ],
  },
  {
    id: "science",
    iconSymbol: "atom",
    title: { en: "Science", de: "Wissenschaft", ja: "科学", ru: "Наука" },
    description: { en: "Research, space and nature.", de: "Forschung, Weltraum und Natur.", ja: "研究、宇宙、自然。", ru: "Исследования, космос и природа." },
    feeds: [
      { title: "Spektrum", url: "https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406", lang: "de", description: { en: "Science news and explanations from a leading magazine.", de: "Wissenschaftsnachrichten und Erklärungen aus dem Magazin.", ja: "科学誌によるニュースと解説。", ru: "Новости науки и объяснения от ведущего журнала." } },
      { title: "scinexx", url: "https://www.scinexx.de/feed/", lang: "de", description: { en: "Findings from research, explained for everyone.", de: "Forschungsergebnisse, verständlich erklärt.", ja: "研究成果をわかりやすく解説。", ru: "Научные открытия, объяснённые для каждого." } },
      { title: "Quanta Magazine", url: "https://www.quantamagazine.org/feed/", lang: "en", description: { en: "Mathematics, physics and biology in depth.", de: "Mathematik, Physik und Biologie in der Tiefe.", ja: "数学、物理、生物学を深く掘り下げる。", ru: "Глубокие статьи о математике, физике и биологии." } },
      { title: "NASA", url: "https://www.nasa.gov/feed/", lang: "en", description: { en: "Missions and discoveries straight from NASA.", de: "Missionen und Entdeckungen direkt von der NASA.", ja: "NASAの探査とその成果。", ru: "Миссии и открытия прямо от NASA." } },
      { title: "Nature", url: "https://www.nature.com/nature.rss", lang: "en", description: { en: "New papers from the leading science journal.", de: "Neue Studien aus der führenden Fachzeitschrift.", ja: "主要科学誌の最新論文。", ru: "Новые статьи от ведущего научного журнала." } },
      { title: "ScienceDaily", url: "https://www.sciencedaily.com/rss/all.xml", lang: "en", description: { en: "Short summaries of new research in every field.", de: "Kurze Zusammenfassungen neuer Forschung aller Fächer.", ja: "あらゆる分野の最新研究の要約。", ru: "Краткие сводки новых исследований по всем областям." } },
      { title: "N+1", url: "https://nplus1.ru/rss", lang: "ru", description: { en: "Science and culture magazine from Russia.", de: "Wissenschafts- und Kulturmagazin aus Russland.", ja: "ロシアの科学・文化雑誌。", ru: "Научно-культурологический журнал из России." } },
      { title: "sorae", url: "https://sorae.info/feed", lang: "ja", description: { en: "Space news and rocket launches.", de: "Raumfahrt-Nachrichten und Raketenstarts.", ja: "宇宙ニュースとロケット打ち上げ情報。", ru: "Новости о космосе и запусках ракет." } },
      { title: "ナゾロジー", url: "https://nazology.kusuguru.co.jp/feed", lang: "ja", description: { en: "Curious science stories in plain language.", de: "Erstaunliche Wissenschaftsgeschichten, leicht erzählt.", ja: "身近な科学の不思議をやさしく紹介。", ru: "Удивительные научные факты простым языком." } },
      { title: "日経サイエンス", url: "https://www.nikkei-science.com/?feed=rss2", lang: "ja", description: { en: "Japanese edition of Scientific American.", de: "Die japanische Ausgabe von Scientific American.", ja: "Scientific American日本版。", ru: "Японское издание Scientific American." } },
    ],
  },
  {
    id: "design",
    iconSymbol: "paintpalette",
    title: { en: "Design", de: "Design", ja: "デザイン", ru: "Дизайн" },
    description: { en: "Web design, interfaces and creative work.", de: "Webdesign, Oberflächen und kreative Arbeit.", ja: "ウェブデザイン、UI、クリエイティブ。", ru: "Веб-дизайн, интерфейсы и творческая работа." },
    feeds: [
      { title: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/", lang: "en", description: { en: "Practical guides for designers and front-end developers.", de: "Praxisnahe Anleitungen für Designer und Frontend-Entwickler.", ja: "デザイナーとフロントエンド開発者向けの実践ガイド。", ru: "Практические руководства для дизайнеров и фронтендеров." } },
      { title: "UX Collective", url: "https://uxdesign.cc/feed", lang: "en", description: { en: "Stories on user experience and product design.", de: "Beiträge zu User Experience und Produktdesign.", ja: "UXとプロダクトデザインの記事。", ru: "Истории о пользовательском опыте и дизайне продуктов." } },
      { title: "Creative Bloq", url: "https://www.creativebloq.com/feeds/all", lang: "en", description: { en: "Inspiration, tutorials and tools for creatives.", de: "Inspiration, Tutorials und Werkzeuge für Kreative.", ja: "クリエイター向けのインスピレーションとチュートリアル。", ru: "Вдохновение, туториалы и инструменты для креативщиков." } },
      { title: "designboom", url: "https://www.designboom.com/feed/", lang: "en", description: { en: "Architecture, art and product design from around the world.", de: "Architektur, Kunst und Produktdesign aus aller Welt.", ja: "世界の建築、アート、プロダクトデザイン。", ru: "Архитектура, искусство и дизайн продуктов со всего мира." } },
      { title: "コリス", url: "https://coliss.com/feed/", lang: "ja", description: { en: "Web design and CSS news in Japanese.", de: "Webdesign- und CSS-Neuigkeiten auf Japanisch.", ja: "ウェブデザインとCSSの最新情報。", ru: "Веб-дизайн и CSS-новости на японском." } },
      { title: "AXIS", url: "https://www.axismag.jp/feed", lang: "ja", description: { en: "Design magazine covering products and spaces.", de: "Designmagazin zu Produkten und Räumen.", ja: "プロダクトと空間を扱うデザイン誌。", ru: "Дизайн-журнал о продуктах и пространствах." } },
      { title: "Web Creator Box", url: "https://www.webcreatorbox.com/feed", lang: "ja", description: { en: "Learning material for web creators.", de: "Lernmaterial für Webgestalter.", ja: "ウェブクリエイター向けの学習コンテンツ。", ru: "Обучающие материалы для веб-креативщиков." } },
    ],
  },
  {
    id: "gaming",
    iconSymbol: "gamecontroller",
    title: { en: "Gaming", de: "Spiele", ja: "ゲーム", ru: "Игры" },
    description: { en: "News, reviews and culture around video games.", de: "Nachrichten, Tests und Kultur rund um Videospiele.", ja: "ゲームのニュース、レビュー、カルチャー。", ru: "Новости, обзоры и культура видеоигр." },
    feeds: [
      { title: "GameStar", url: "https://www.gamestar.de/news/rss/news.rss", lang: "de", description: { en: "PC and console game news from Germany.", de: "Neuigkeiten zu PC- und Konsolenspielen.", ja: "PC・コンソールゲームのドイツ語ニュース。", ru: "Новости PC и консольных игр из Германии." } },
      { title: "PC Games", url: "https://www.pcgames.de/feed.cfm?menu_alias=home/", lang: "de", description: { en: "PC gaming news, previews and tests.", de: "PC-Spiele-News, Vorschauen und Tests.", ja: "PCゲームのニュースとレビュー。", ru: "Новости, превью и тесты PC-игр." } },
      { title: "Eurogamer", url: "https://www.eurogamer.net/feed", lang: "en", description: { en: "Reviews and features on games of every kind.", de: "Tests und Reportagen zu Spielen aller Art.", ja: "あらゆるゲームのレビューと特集。", ru: "Обзоры и статьи обо всех видах игр." } },
      { title: "Polygon", url: "https://www.polygon.com/rss/index.xml", lang: "en", description: { en: "Games, their makers and their communities.", de: "Spiele, ihre Macher und ihre Communities.", ja: "ゲームとその作り手、コミュニティ。", ru: "Игры, их создатели и сообщества." } },
      { title: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/feed", lang: "en", description: { en: "PC gaming with a sharp, personal voice.", de: "PC-Spiele mit pointierter, persönlicher Stimme.", ja: "個性的な視点で語るPCゲーム媒体。", ru: "PC-игры с острым, личным взглядом." } },
      { title: "4Gamer.net", url: "https://www.4gamer.net/rss/index.xml", lang: "ja", description: { en: "Japan's PC and online game news.", de: "PC- und Online-Spiele-News aus Japan.", ja: "PC・オンラインゲームの最新情報。", ru: "Новости PC и онлайн-игр из Японии." } },
      { title: "AUTOMATON", url: "https://automaton-media.com/feed/", lang: "ja", description: { en: "Game news and interviews from Japan.", de: "Spiele-News und Interviews aus Japan.", ja: "ゲームのニュースとインタビュー。", ru: "Новости об играх и интервью из Японии." } },
    ],
  },
  {
    id: "business",
    iconSymbol: "chart.line.uptrend.xyaxis",
    title: { en: "Business", de: "Wirtschaft", ja: "経済", ru: "Бизнес" },
    description: { en: "Markets, companies and the economy.", de: "Märkte, Unternehmen und Konjunktur.", ja: "市場、企業、経済。", ru: "Рынки, компании и экономика." },
    feeds: [
      { title: "Tagesschau Wirtschaft", url: "https://www.tagesschau.de/wirtschaft/index~rss2.xml", lang: "de", description: { en: "Economy news from public television.", de: "Wirtschaftsnachrichten des öffentlich-rechtlichen Fernsehens.", ja: "公共放送による経済ニュース。", ru: "Экономические новости от государственного ТВ." } },
      { title: "Handelsblatt", url: "https://www.handelsblatt.com/contentexport/feed/top-themen", lang: "de", description: { en: "Top stories on business, finance and politics.", de: "Top-Themen zu Wirtschaft, Finanzen und Politik.", ja: "経済・金融・政治の主要記事。", ru: "Главные темы о бизнесе, финансах и политике." } },
      { title: "ZEIT Wirtschaft", url: "https://newsfeed.zeit.de/wirtschaft/index", lang: "de", description: { en: "Economic analysis from the weekly paper.", de: "Wirtschaftsanalysen aus der Wochenzeitung.", ja: "週刊紙による経済分析。", ru: "Экономический анализ из еженедельника." } },
      { title: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", lang: "en", description: { en: "Business and economy news from the BBC.", de: "Wirtschaftsnachrichten der BBC.", ja: "BBCの経済ニュース。", ru: "Новости бизнеса и экономики от BBC." } },
      { title: "The Economist", url: "https://www.economist.com/finance-and-economics/rss.xml", lang: "en", description: { en: "Finance and economics in the weekly's own analysis.", de: "Finanzen und Wirtschaft in der Analyse des Wochenmagazins.", ja: "週刊誌による金融・経済の分析。", ru: "Финансы и экономика в анализе еженедельника." } },
      { title: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", lang: "en", description: { en: "Markets and company news from the US.", de: "Märkte und Unternehmensnachrichten aus den USA.", ja: "米国の市場と企業のニュース。", ru: "Новости рынков и компаний из США." } },
      { title: "東洋経済オンライン", url: "https://toyokeizai.net/list/feed/rss", lang: "ja", description: { en: "Business and economy articles from Japan.", de: "Wirtschaftsartikel aus Japan.", ja: "ビジネスと経済の話題。", ru: "Статьи о бизнесе и экономике из Японии." } },
    ],
  },
  {
    id: "sport",
    iconSymbol: "sportscourt",
    title: { en: "Sport", de: "Sport", ja: "スポーツ", ru: "Спорт" },
    description: { en: "Results, reports and background from the world of sport.", de: "Ergebnisse, Berichte und Hintergründe aus dem Sport.", ja: "試合結果、レポート、スポーツの背景。", ru: "Результаты, репортажи и аналитика из мира спорта." },
    feeds: [
      { title: "Sportschau", url: "https://www.sportschau.de/index~rss2.xml", lang: "de", description: { en: "Sport news from public television.", de: "Sportnachrichten des öffentlich-rechtlichen Fernsehens.", ja: "公共放送によるスポーツニュース。", ru: "Спортивные новости от государственного ТВ." } },
      { title: "Sportschau Fußball", url: "https://www.sportschau.de/fussball/index~rss2.xml", lang: "de", description: { en: "Football news, Bundesliga and more.", de: "Fußball-News, Bundesliga und mehr.", ja: "サッカーとブンデスリーガのニュース。", ru: "Новости футбола, Бундеслига и другое." } },
      { title: "kicker", url: "https://newsfeed.kicker.de/news/aktuell", lang: "de", description: { en: "Football news and match reports.", de: "Fußball-Nachrichten und Spielberichte.", ja: "サッカーのニュースと試合レポート。", ru: "Новости футбола и отчёты о матчах." } },
      { title: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml", lang: "en", description: { en: "Results and stories from every sport.", de: "Ergebnisse und Geschichten aus allen Sportarten.", ja: "あらゆる競技の結果と記事。", ru: "Результаты и статьи из всех видов спорта." } },
      { title: "The Guardian Sport", url: "https://www.theguardian.com/sport/rss", lang: "en", description: { en: "Sport reporting and comment from the Guardian.", de: "Sportberichte und Kommentare des Guardian.", ja: "ガーディアン紙のスポーツ報道。", ru: "Спортивная журналистика и комментарии Guardian." } },
    ],
  },
  {
    id: "culture",
    iconSymbol: "theatermasks",
    title: { en: "Culture", de: "Kultur", ja: "カルチャー", ru: "Культура" },
    description: { en: "Film, music, books and art.", de: "Film, Musik, Bücher und Kunst.", ja: "映画、音楽、本、アート。", ru: "Кино, музыка, книги и искусство." },
    feeds: [
      { title: "Monopol", url: "https://www.monopol-magazin.de/rss.xml", lang: "de", description: { en: "Contemporary art and its market.", de: "Zeitgenössische Kunst und Kunstmarkt.", ja: "現代アートとアート市場。", ru: "Современное искусство и арт-рынок." } },
      { title: "The Guardian Film", url: "https://www.theguardian.com/film/rss", lang: "en", description: { en: "Film reviews and cinema news.", de: "Filmkritiken und Kinonachrichten.", ja: "映画レビューと映画館のニュース。", ru: "Кинокритика и новости кино." } },
      { title: "The Guardian Books", url: "https://www.theguardian.com/books/rss", lang: "en", description: { en: "Book reviews, authors and literary news.", de: "Buchkritiken, Autoren und Literaturnachrichten.", ja: "書評、作家、文学ニュース。", ru: "Книжные рецензии, авторы и литературные новости." } },
      { title: "Pitchfork", url: "https://pitchfork.com/feed/feed-news/rss", lang: "en", description: { en: "Music news and album reviews.", de: "Musiknachrichten und Albumkritiken.", ja: "音楽ニュースとアルバムレビュー。", ru: "Музыкальные новости и рецензии на альбомы." } },
      { title: "The Marginalian", url: "https://www.themarginalian.org/feed/", lang: "en", description: { en: "Essays on art, science and the examined life.", de: "Essays über Kunst, Wissenschaft und das Nachdenken.", ja: "アートと科学、人生をめぐるエッセイ。", ru: "Эссе об искусстве, науке и осмысленной жизни." } },
      { title: "CINRA", url: "https://www.cinra.net/feed", lang: "ja", description: { en: "Art, music and culture in Japan.", de: "Kunst, Musik und Kultur aus Japan.", ja: "アート、音楽、カルチャーの話題。", ru: "Искусство, музыка и культура в Японии." } },
    ],
  },
];
