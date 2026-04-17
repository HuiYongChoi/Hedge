"""Constants and utilities related to analysts configuration."""

from src.agents import portfolio_manager
from src.agents.aswath_damodaran import aswath_damodaran_agent
from src.agents.ben_graham import ben_graham_agent
from src.agents.bill_ackman import bill_ackman_agent
from src.agents.cathie_wood import cathie_wood_agent
from src.agents.charlie_munger import charlie_munger_agent
from src.agents.fundamentals import fundamentals_analyst_agent
from src.agents.michael_burry import michael_burry_agent
from src.agents.phil_fisher import phil_fisher_agent
from src.agents.peter_lynch import peter_lynch_agent
from src.agents.sentiment import sentiment_analyst_agent
from src.agents.stanley_druckenmiller import stanley_druckenmiller_agent
from src.agents.technicals import technical_analyst_agent
from src.agents.valuation import valuation_analyst_agent
from src.agents.warren_buffett import warren_buffett_agent
from src.agents.rakesh_jhunjhunwala import rakesh_jhunjhunwala_agent
from src.agents.mohnish_pabrai import mohnish_pabrai_agent
from src.agents.nassim_taleb import nassim_taleb_agent
from src.agents.news_sentiment import news_sentiment_agent
from src.agents.growth_agent import growth_analyst_agent

# Define analyst configuration - single source of truth
ANALYST_CONFIG = {
    "aswath_damodaran": {
        "display_name": "Aswath Damodaran",
        "display_name_ko": "애스워스 다모다란",
        "description": "The Dean of Valuation",
        "description_ko": "가치평가의 대가",
        "investing_style": "Focuses on intrinsic value and financial metrics to assess investment opportunities through rigorous valuation analysis.",
        "investing_style_ko": "엄밀한 기업가치 분석을 통해 내재가치와 재무지표에 집중하여 투자 기회를 평가합니다.",
        "agent_func": aswath_damodaran_agent,
        "type": "analyst",
        "order": 0,
    },
    "ben_graham": {
        "display_name": "Ben Graham",
        "display_name_ko": "벤 그레이엄",
        "description": "The Father of Value Investing",
        "description_ko": "가치투자의 아버지",
        "investing_style": "Emphasizes a margin of safety and invests in undervalued companies with strong fundamentals through systematic value analysis.",
        "investing_style_ko": "안전마진을 중시하며 체계적인 가치 분석을 통해 탄탄한 기초체력을 가진 저평가 기업에 투자합니다.",
        "agent_func": ben_graham_agent,
        "type": "analyst",
        "order": 1,
    },
    "bill_ackman": {
        "display_name": "Bill Ackman",
        "display_name_ko": "빌 애크먼",
        "description": "The Activist Investor",
        "description_ko": "행동주의 투자자",
        "investing_style": "Seeks to influence management and unlock value through strategic activism and contrarian investment positions.",
        "investing_style_ko": "전략적 행동주의와 역발상 투자 포지션으로 경영에 영향을 미쳐 가치를 창출합니다.",
        "agent_func": bill_ackman_agent,
        "type": "analyst",
        "order": 2,
    },
    "cathie_wood": {
        "display_name": "Cathie Wood",
        "display_name_ko": "캐시 우드",
        "description": "The Queen of Growth Investing",
        "description_ko": "성장투자의 여왕",
        "investing_style": "Focuses on disruptive innovation and growth, investing in companies that are leading technological advancements and market disruption.",
        "investing_style_ko": "기술 혁신과 시장 파괴를 이끄는 기업에 투자하며 파괴적 혁신과 성장에 집중합니다.",
        "agent_func": cathie_wood_agent,
        "type": "analyst",
        "order": 3,
    },
    "charlie_munger": {
        "display_name": "Charlie Munger",
        "display_name_ko": "찰리 멍거",
        "description": "The Rational Thinker",
        "description_ko": "합리적 사상가",
        "investing_style": "Advocates for value investing with a focus on quality businesses and long-term growth through rational decision-making.",
        "investing_style_ko": "합리적 의사결정을 통해 우량 기업의 장기 성장에 집중하는 가치투자를 지지합니다.",
        "agent_func": charlie_munger_agent,
        "type": "analyst",
        "order": 4,
    },
    "michael_burry": {
        "display_name": "Michael Burry",
        "display_name_ko": "마이클 버리",
        "description": "The Big Short Contrarian",
        "description_ko": "빅쇼트 역발상 투자자",
        "investing_style": "Makes contrarian bets, often shorting overvalued markets and investing in undervalued assets through deep fundamental analysis.",
        "investing_style_ko": "깊이 있는 기초분석으로 고평가 시장을 공매도하고 저평가 자산에 투자하는 역발상 베팅을 합니다.",
        "agent_func": michael_burry_agent,
        "type": "analyst",
        "order": 5,
    },
    "mohnish_pabrai": {
        "display_name": "Mohnish Pabrai",
        "display_name_ko": "모니시 파브라이",
        "description": "The Dhandho Investor",
        "description_ko": "단도 투자자",
        "investing_style": "Focuses on value investing and long-term growth through fundamental analysis and a margin of safety.",
        "investing_style_ko": "기초분석과 안전마진을 기반으로 가치투자와 장기 성장에 집중합니다.",
        "agent_func": mohnish_pabrai_agent,
        "type": "analyst",
        "order": 6,
    },
    "nassim_taleb": {
        "display_name": "Nassim Taleb",
        "display_name_ko": "나심 탈레브",
        "description": "The Black Swan Risk Analyst",
        "description_ko": "블랙스완 리스크 분석가",
        "investing_style": "Focuses on tail risk, antifragility, and asymmetric payoffs. Uses barbell strategy, avoids fragile companies via negativa, and seeks convex positions with limited downside and unlimited upside.",
        "investing_style_ko": "꼬리 위험·반취약성·비대칭 수익에 집중합니다. 바벨 전략을 사용하고, 취약 기업을 배제하며, 손실 제한 및 무한 이익의 볼록 포지션을 추구합니다.",
        "agent_func": nassim_taleb_agent,
        "type": "analyst",
        "order": 7,
    },
    "peter_lynch": {
        "display_name": "Peter Lynch",
        "display_name_ko": "피터 린치",
        "description": "The 10-Bagger Investor",
        "description_ko": "텐배거 투자자",
        "investing_style": "Invests in companies with understandable business models and strong growth potential using the 'buy what you know' strategy.",
        "investing_style_ko": "'아는 것에 투자하라' 전략으로 이해하기 쉬운 비즈니스 모델과 강한 성장 잠재력을 가진 기업에 투자합니다.",
        "agent_func": peter_lynch_agent,
        "type": "analyst",
        "order": 8,
    },
    "phil_fisher": {
        "display_name": "Phil Fisher",
        "display_name_ko": "필 피셔",
        "description": "The Scuttlebutt Investor",
        "description_ko": "스커틀버트 투자자",
        "investing_style": "Emphasizes investing in companies with strong management and innovative products, focusing on long-term growth through scuttlebutt research.",
        "investing_style_ko": "스커틀버트 조사로 우수한 경영진과 혁신적 제품을 보유한 기업에 투자하며 장기 성장에 집중합니다.",
        "agent_func": phil_fisher_agent,
        "type": "analyst",
        "order": 9,
    },
    "rakesh_jhunjhunwala": {
        "display_name": "Rakesh Jhunjhunwala",
        "display_name_ko": "라케시 준준왈라",
        "description": "The Big Bull Of India",
        "description_ko": "인도의 빅불",
        "investing_style": "Leverages macroeconomic insights to invest in high-growth sectors, particularly within emerging markets and domestic opportunities.",
        "investing_style_ko": "거시경제 통찰력을 활용해 신흥시장과 국내 고성장 섹터에 투자합니다.",
        "agent_func": rakesh_jhunjhunwala_agent,
        "type": "analyst",
        "order": 10,
    },
    "stanley_druckenmiller": {
        "display_name": "Stanley Druckenmiller",
        "display_name_ko": "스탠리 드러켄밀러",
        "description": "The Macro Investor",
        "description_ko": "거시 투자자",
        "investing_style": "Focuses on macroeconomic trends, making large bets on currencies, commodities, and interest rates through top-down analysis.",
        "investing_style_ko": "하향식 분석으로 통화·원자재·금리에 대한 대규모 거시경제 베팅에 집중합니다.",
        "agent_func": stanley_druckenmiller_agent,
        "type": "analyst",
        "order": 11,
    },
    "warren_buffett": {
        "display_name": "Warren Buffett",
        "display_name_ko": "워런 버핏",
        "description": "The Oracle of Omaha",
        "description_ko": "오마하의 현인",
        "investing_style": "Seeks companies with strong fundamentals and competitive advantages through value investing and long-term ownership.",
        "investing_style_ko": "가치투자와 장기 보유를 통해 탄탄한 기초체력과 경쟁우위를 가진 기업을 발굴합니다.",
        "agent_func": warren_buffett_agent,
        "type": "analyst",
        "order": 12,
    },
    "technical_analyst": {
        "display_name": "Technical Analyst",
        "display_name_ko": "기술적 분석가",
        "description": "Chart Pattern Specialist",
        "description_ko": "차트 패턴 전문가",
        "investing_style": "Focuses on chart patterns and market trends to make investment decisions, often using technical indicators and price action analysis.",
        "investing_style_ko": "차트 패턴과 시장 추세를 분석하여 기술적 지표와 가격 움직임을 기반으로 투자 결정을 내립니다.",
        "agent_func": technical_analyst_agent,
        "type": "analyst",
        "order": 13,
    },
    "fundamentals_analyst": {
        "display_name": "Fundamentals Analyst",
        "display_name_ko": "기본적 분석가",
        "description": "Financial Statement Specialist",
        "description_ko": "재무제표 전문가",
        "investing_style": "Delves into financial statements and economic indicators to assess the intrinsic value of companies through fundamental analysis.",
        "investing_style_ko": "재무제표와 경제지표를 심층 분석하여 기본적 분석으로 기업의 내재가치를 평가합니다.",
        "agent_func": fundamentals_analyst_agent,
        "type": "analyst",
        "order": 14,
    },
    "growth_analyst": {
        "display_name": "Growth Analyst",
        "display_name_ko": "성장 분석가",
        "description": "Growth Specialist",
        "description_ko": "성장주 전문가",
        "investing_style": "Analyzes growth trends and valuation to identify growth opportunities through growth analysis.",
        "investing_style_ko": "성장 추세와 밸류에이션을 분석하여 성장 기회를 발굴합니다.",
        "agent_func": growth_analyst_agent,
        "type": "analyst",
        "order": 15,
    },
    "news_sentiment_analyst": {
        "display_name": "News Sentiment Analyst",
        "display_name_ko": "뉴스 감성 분석가",
        "description": "News Sentiment Specialist",
        "description_ko": "뉴스 심리 전문가",
        "investing_style": "Analyzes news sentiment to predict market movements and identify opportunities through news analysis.",
        "investing_style_ko": "뉴스 감성을 분석하여 시장 움직임을 예측하고 투자 기회를 발굴합니다.",
        "agent_func": news_sentiment_agent,
        "type": "analyst",
        "order": 16,
    },
    "sentiment_analyst": {
        "display_name": "Sentiment Analyst",
        "display_name_ko": "시장 심리 분석가",
        "description": "Market Sentiment Specialist",
        "description_ko": "시장 심리 전문가",
        "investing_style": "Gauges market sentiment and investor behavior to predict market movements and identify opportunities through behavioral analysis.",
        "investing_style_ko": "행동 분석을 통해 시장 심리와 투자자 행동을 파악하여 시장 움직임을 예측하고 기회를 발굴합니다.",
        "agent_func": sentiment_analyst_agent,
        "type": "analyst",
        "order": 17,
    },
    "valuation_analyst": {
        "display_name": "Valuation Analyst",
        "display_name_ko": "가치평가 분석가",
        "description": "Company Valuation Specialist",
        "description_ko": "기업 가치평가 전문가",
        "investing_style": "Specializes in determining the fair value of companies, using various valuation models and financial metrics for investment decisions.",
        "investing_style_ko": "다양한 가치평가 모델과 재무지표를 활용하여 기업의 적정가치를 산출하는 데 특화되어 있습니다.",
        "agent_func": valuation_analyst_agent,
        "type": "analyst",
        "order": 18,
    },
}

# Derive ANALYST_ORDER from ANALYST_CONFIG for backwards compatibility
ANALYST_ORDER = [(config["display_name"], key) for key, config in sorted(ANALYST_CONFIG.items(), key=lambda x: x[1]["order"])]


def get_analyst_nodes():
    """Get the mapping of analyst keys to their (node_name, agent_func) tuples."""
    return {key: (f"{key}_agent", config["agent_func"]) for key, config in ANALYST_CONFIG.items()}


def get_agents_list():
    """Get the list of agents for API responses, including Korean localizations."""
    return [
        {
            "key": key,
            "display_name": config["display_name"],
            "display_name_ko": config.get("display_name_ko", config["display_name"]),
            "description": config["description"],
            "description_ko": config.get("description_ko", config["description"]),
            "investing_style": config["investing_style"],
            "investing_style_ko": config.get("investing_style_ko", config["investing_style"]),
            "order": config["order"],
        }
        for key, config in sorted(ANALYST_CONFIG.items(), key=lambda x: x[1]["order"])
    ]
