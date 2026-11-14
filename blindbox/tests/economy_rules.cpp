#include "economy.h"
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
using namespace blindbox;
using nlohmann::json;
static int checks = 0;
void check(bool value, const char* message) { ++checks; if (!value) throw std::runtime_error(message); }
GameConfig fixture() {
    GameConfig cfg; cfg.economy.startCoins=10000;
    cfg.rarities={{"common","普通",.6,30,"#999999"},{"rare","稀有",.3,80,"#4488cc"},
        {"epic","史诗",.085,250,"#9955cc"},{"secret","隐藏款",.015,1000,"#ccaa55"}};
    for (int i=0;i<2;++i) {
        Series series;series.id="s"+std::to_string(i);series.name=series.id;series.boxPrice=100*(i+1);series.sellMultiplier=i+1;
        for(const auto& rarity:cfg.rarities) {
            series.items.push_back({series.id+"-"+rarity.key,rarity.label,rarity.key,"测试款",1,""});
            series.dropRates[rarity.key]=rarity.dropRate;
        }
        cfg.series.push_back(series);
    }
    cfg.series[0].items.push_back({"s0-epic-b","第二款史诗","epic","测试款",3,""});
    finalizeConfig(cfg);return cfg;
}
void setOnly(GameConfig& cfg,int index,const std::string& rarity) {
    for(const auto& r:cfg.rarities)cfg.series[index].dropRates[r.key]=r.key==rarity?1:0;
}
int main() {
    try {
        auto cfg=fixture();check(validateConfig(cfg).empty(),"pure drawing fixture valid");
        check(std::fabs(cfg.itemChanceOf(cfg.series[0],cfg.series[0].items[2])-.02125)<1e-12,"single item chance includes weights");
        auto exported=configToJson(cfg);
        check(!exported.contains("shop")&&!exported.contains("tokens")&&!exported["economy"].contains("pity"),"config has no retired features");
        auto invalid=cfg;invalid.series[0].dropRates["secret"]=.3;
        check(!validateConfig(invalid).empty(),"invalid probability total rejected");
        invalid=cfg;invalid.series[0].dropRates={{"common",.5},{"rare",.25},{"epic",.10},{"secret",.15}};
        check(!validateConfig(invalid).empty(),"secret probability inversion rejected");
        auto fallback=cfg;fallback.series[0].dropRates.clear();
        check(fallback.dropRateOf(fallback.series[0],"secret")==.015,"new series can inherit global default");
        auto deterministic=fixture();setOnly(deterministic,0,"common");setOnly(deterministic,1,"secret");
        Economy pure(deterministic,42);auto p=pure.newPlayer();p.coins=1000000;
        for(int i=0;i<120;++i){check(pure.open(p,"s0").ok&&p.pending->rarity=="common","no hidden pity threshold");pure.pendingToStorage(p);}
        check(pure.open(p,"s1").ok&&p.pending->rarity=="secret","series distributions independent");
        const auto pending=stateToJson(p);
        check(!pure.open(p,"s0").ok&&pending==stateToJson(p),"pending cannot be overwritten");
        check(!pending.contains("shop")&&!pending.contains("tokens")&&!pending.contains("pity"),"new save is pure drawing state");
        pure.pendingToStorage(p);
        auto collectionCfg=fixture();setOnly(collectionCfg,0,"epic");Economy collection(collectionCfg,42);auto c=collection.newPlayer();
        check(!collection.open(c,"unknown").ok&&c.coins==10000,"unknown box has no charge");
        check(collection.open(c,"s0").ok&&c.coins==9900&&c.coinsSpent==100&&c.boxesOpened==1,"normal draw charges once");
        const std::string first=c.pending->itemId;
        check(collection.pendingToShowcase(c).ok&&c.showcase["s0"].count(first),"drawn collectible can enter showcase");
        check(collection.open(c,"s0").ok&&c.pending->itemId!=first&&c.pending->preferredNew,"no duplicate rule prefers unseen item");
        const Entry second=*c.pending;
        check(collection.pendingToStorage(c).ok&&c.storage.size()==1&&!c.pending,"collectible can be stored");
        check(collection.reopenFromStorage(c,second.uid).ok&&c.storage.empty()&&c.boxesOpened==2,"storage reopening not a new draw");
        const int beforeSale=c.coins;
        check(collection.sellPending(c).ok&&c.coins==beforeSale+250&&c.everOwned.count(second.itemId),"sale retains ownership history");
        check(!collection.sellPending(c).ok&&c.coins==beforeSale+250,"sale cannot repeat");
        check(collection.showcaseToStorage(c,"s0",first).ok&&c.showcase["s0"].empty(),"showcase item can return to storage");
        auto uid=c.storage.front().uid;
        check(collection.sellFromStorage(c,uid).ok&&c.storage.empty(),"stored item can be sold");
        check(!collection.sellFromStorage(c,uid).ok,"stored sale cannot repeat");
        auto saved=stateToJson(c);check(saved==stateToJson(stateFromJson(saved)),"collection and wallet round trip");
        auto broke=collection.newPlayer();broke.coins=0;
        check(collection.bailout(broke).ok&&broke.coins==collectionCfg.economy.bailoutCoins&&broke.bailoutCount==1,"bankruptcy support works");
        check(!collection.bailout(broke).ok,"support cannot repeat while affordable");
        broke.coins=0;collection.open(broke,"s0");check(!collection.bailoutEligible(broke),"pending prevents support");
        collection.pendingToStorage(broke);broke.coins=0;check(!collection.bailoutEligible(broke),"sellable storage prevents support");
        auto complete=collection.newPlayer();
        for(const auto& series:collectionCfg.series)for(const auto& item:series.items)complete.showcase[series.id].insert(item.id);
        check(collection.isAllComplete(complete)&&collection.progressJson(complete)["owned"]==9,"completion follows configured item count");
        check(collection.showcaseValue(complete)>0,"showcase valuation preserved");
        auto old=saved;old["tokens"]={{"s0",50}};old["pity"]={{"s0",7}};
        old["shop"]["contract"]={{"id","legacy"},{"status","active"},{"budget",800},{"remaining",400},{"rulesVersion",2},{"personalSpent",350}};
        const int oldCoins=old["coins"];auto migrated=stateToJson(stateFromJson(old));
        check(migrated["coins"]==oldCoins+350&&migrated["storage"]==old["storage"]&&migrated["showcase"]==old["showcase"]&&migrated["everOwned"]==old["everOwned"],"refund own advance and preserve collectibles");
        check(!migrated.contains("shop")&&!migrated.contains("tokens")&&!migrated.contains("pity"),"retired state stripped on save");
        check(migrated==stateToJson(stateFromJson(migrated)),"refund not replayed after restart");
        old["shop"]["contract"]["rulesVersion"]=1;old["shop"]["contract"]["deposit"]=160;
        check(stateFromJson(old).coins==oldCoins+160,"legacy deposit refunded rather than customer remaining budget");
        for(const auto* status:{"succeeded","failed","cancelled"}){old["shop"]["contract"]["status"]=status;check(stateFromJson(old).coins==oldCoins,"ended contract not refunded");}
        old["shop"]["contract"]["status"]="active";old["shop"]["contract"]["deposit"]=-100;
        check(stateFromJson(old).coins==oldCoins,"negative refund ignored");
        old["coins"]=std::numeric_limits<int>::max()-10;old["shop"]["contract"]["deposit"]=100;
        check(stateFromJson(old).coins==std::numeric_limits<int>::max(),"refund respects wallet limit");
        auto weightedCfg=fixture();weightedCfg.economy.noDupeUntilOwned=false;setOnly(weightedCfg,0,"epic");
        Economy weighted(weightedCfg,42);auto weights=weighted.newPlayer();weights.coins=1000000;int heavier=0;
        for(int i=0;i<8000;++i){weighted.open(weights,"s0");if(weights.pending->itemId=="s0-epic-b")++heavier;weighted.sellPending(weights);}
        check(heavier>5700&&heavier<6300,"relative weights govern repeated ordinary draws");
        std::cout<<"Passed "<<checks<<" drawing, collection and migration checks\n";return 0;
    }catch(const std::exception& e){std::cerr<<"FAILED: "<<e.what()<<'\n';return 1;}
}
