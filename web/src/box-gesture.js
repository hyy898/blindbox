/** Resolve a second desktop click even when the selected box has moved away. */
export function createBoxGesture({interval=500,distance=28}={}) {
  let previous=null;
  return {
    click({id,x,y,time,pointer}) {
      const second=pointer&&previous&&time-previous.time>=0&&time-previous.time<=interval&&
        (id===previous.id||Math.hypot(x-previous.x,y-previous.y)<=distance);
      if(second){const open=previous.id;previous=null;return {select:null,open};}
      previous=pointer&&id!==null?{id,x,y,time}:null;
      return {select:id,open:null};
    }
  };
}
