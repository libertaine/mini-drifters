import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRecords, RECORDS_KEY, SCHEMA_VERSION } from '../src/records.js';
import { SCORING_VERSION } from '../src/scoring.js';
const fixture=JSON.parse(readFileSync(new URL('fixtures/records-v0.5.0.json',import.meta.url)));
test('v0.5.0 records read, retain and improve through v0.6.0 with the same identities',()=>{
  assert.equal(RECORDS_KEY,'mini-drifters-records-v3'); assert.equal(SCHEMA_VERSION,3); assert.equal(SCORING_VERSION,'scoring-2');
  for(const handling of ['classic','revised']) {
    const map=new Map(Object.entries(fixture.storage)); const writes=[];
    const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>{writes.push(k);map.set(k,v);}};
    const records=createRecords(()=>storage);
    const before=JSON.parse(map.get(RECORDS_KEY));
    for(const track of ['original','switchback','dockyard']) for(const mode of ['classic','revised']) {
      const old=before.tracks[track][mode];
      assert.deepEqual(records.forTrack(track,mode),{fastestLap:old.fastestLap,...old.scoring[SCORING_VERSION]});
    }
    assert.deepEqual(writes,[],'reading never rewrites or resets storage');
    const base={trackId:'dockyard',handling,runId:100};
    records.handle({...base,type:'start',mode:'normal'});
    records.handle({...base,type:'lap',valid:true,time:99});
    records.handle({...base,type:'finish',completed:3,score:1,bestCombo:1});
    assert.equal(map.get(RECORDS_KEY),fixture.storage[RECORDS_KEY],'slower results retain old bests');
    records.handle({...base,runId:101,type:'start',mode:'normal'});
    records.handle({...base,runId:101,type:'lap',valid:true,time:30});
    records.handle({...base,runId:101,type:'finish',completed:3,score:2000,bestCombo:300});
    const after=JSON.parse(map.get(RECORDS_KEY));
    const expected=structuredClone(before);
    expected.tracks.dockyard[handling].fastestLap=30;
    expected.tracks.dockyard[handling].scoring[SCORING_VERSION]={score:2000,bestCombo:300};
    assert.equal(after.version,expected.version);
    for(const track of ['original','switchback','dockyard']) {
      assert.deepEqual(after.tracks[track],expected.tracks[track],`only improved Dockyard handling partition changes (${track})`);
    }
    for(const track of ['runway-27','redline-mesa','headland-run','nightshift-viaduct']) {
      for(const mode of ['classic','revised']) {
        assert.deepEqual(records.forTrack(track,mode),{score:null,fastestLap:null,bestCombo:null});
      }
    }
    assert.ok(writes.length>0 && writes.every(k=>k===RECORDS_KEY));
    assert.equal(map.get('unrelated-owner-preference'),'keep');
    const reloaded=createRecords(()=>storage);
    assert.deepEqual(reloaded.forTrack('dockyard',handling),{score:2000,fastestLap:30,bestCombo:300});
    assert.deepEqual([...map.keys()].sort(),Object.keys(fixture.storage).sort(),'no new partition or storage key');
  }
});
