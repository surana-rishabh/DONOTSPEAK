import * as THREE from "three";

type Joint = { bone: THREE.Bone; rest: THREE.Quaternion; direction: THREE.Vector3 };
type Leg = { hip: Joint; knee: Joint; origin: THREE.Vector3; foot: THREE.Vector3; upper: number; lower: number; side: number };

// Pose the shipped skeleton without changing its bind matrices or the GLB.
export class CallerAnimator {
  private legs: Leg[] = [];
  private arms: Array<{ joint: Joint; side: number }> = [];
  private phase = 0;
  private blend = 0;
  private rotation = new THREE.Quaternion();
  private inverse = new THREE.Quaternion();
  private direction = new THREE.Vector3();
  private restDirection = new THREE.Vector3();
  private bendDirection = new THREE.Vector3();
  private kneePoint = new THREE.Vector3();
  private footPoint = new THREE.Vector3();
  private hipPoint = new THREE.Vector3();
  constructor(private root: THREE.Object3D, object: THREE.Object3D) {
    root.updateWorldMatrix(true, true);
    const bones: THREE.Bone[] = [];
    object.traverse((node) => { if (node instanceof THREE.Bone) bones.push(node); });
    const joint = (bone: THREE.Bone, direction = new THREE.Vector3(0, 1, 0)): Joint => ({ bone, rest: bone.quaternion.clone(), direction: direction.clone().normalize() });
    for (const [side, name] of [[1, "L"], [-1, "R"]] as const) {
      const hip = bones.find((bone) => new RegExp(`Leg1[._]?${name}_`).test(bone.name));
      const knee = bones.find((bone) => new RegExp(`Leg2[._]?${name}_`).test(bone.name));
      const arm = bones.find((bone) => new RegExp(`Arm1[._]?${name}_`).test(bone.name));
      if (arm) {
        const forearm = arm.children.find((child) => child instanceof THREE.Bone);
        const armJoint = joint(arm, forearm?.position);
        this.aim(armJoint, new THREE.Vector3(0, -1, 0).transformDirection(root.matrixWorld));
        armJoint.rest.copy(arm.quaternion);
        this.arms.push({ joint: armJoint, side });
      }
      if (!hip || !knee) continue;
      root.updateWorldMatrix(true, true);
      const origin = root.worldToLocal(hip.getWorldPosition(new THREE.Vector3()));
      const kneePosition = root.worldToLocal(knee.getWorldPosition(new THREE.Vector3()));
      const upper = origin.distanceTo(kneePosition);
      const lower = upper * 0.98;
      const foot = kneePosition.clone().add(new THREE.Vector3(0, -lower, 0));
      foot.y = Math.max(0.03, foot.y);
      this.legs.push({ hip: joint(hip, knee.position), knee: joint(knee), origin, foot, upper, lower, side });
    }
    this.update(0, 0, false);
  }
  private aim(joint: Joint, worldDirection: THREE.Vector3) {
    joint.bone.parent!.getWorldQuaternion(this.inverse).invert();
    this.direction.copy(worldDirection).applyQuaternion(this.inverse).normalize();
    this.rotation.setFromUnitVectors(this.restDirection.copy(joint.direction).applyQuaternion(joint.rest), this.direction);
    joint.bone.quaternion.copy(this.rotation.multiply(joint.rest));
    joint.bone.updateWorldMatrix(false, true);
  }
  update(dt: number, distance: number, reducedMotion: boolean) {
    this.phase += distance / 1.15 * Math.PI * 2;
    this.blend = reducedMotion ? 0 : THREE.MathUtils.damp(this.blend, distance > 0 ? 1 : 0, 10, dt);
    this.root.updateWorldMatrix(true, true);
    for (const leg of this.legs) {
      const phase = this.phase + (leg.side < 0 ? Math.PI : 0);
      // Stance moves backward at ground height; swing lifts only the advancing foot.
      const stride = Math.cos(phase) * 0.27 * this.blend;
      const lift = Math.max(0, -Math.sin(phase)) * 0.13 * this.blend;
      this.footPoint.copy(leg.foot); this.footPoint.z += stride; this.footPoint.y += lift;
      this.hipPoint.copy(leg.origin);
      const delta = this.direction.copy(this.footPoint).sub(this.hipPoint);
      const length = Math.min(delta.length(), leg.upper + leg.lower - 0.001);
      delta.normalize();
      const along = (leg.upper ** 2 - leg.lower ** 2 + length ** 2) / (2 * length);
      const bend = Math.sqrt(Math.max(0, leg.upper ** 2 - along ** 2));
      const forward = this.bendDirection.set(0, 0, 1).addScaledVector(delta, -delta.z).normalize();
      this.kneePoint.copy(this.hipPoint).addScaledVector(delta, along).addScaledVector(forward, bend);
      this.root.localToWorld(this.hipPoint); this.root.localToWorld(this.kneePoint); this.root.localToWorld(this.footPoint);
      this.aim(leg.hip, this.direction.copy(this.kneePoint).sub(this.hipPoint));
      this.aim(leg.knee, this.direction.copy(this.footPoint).sub(this.kneePoint));
    }
    for (const { joint, side } of this.arms) {
      const swing = Math.cos(this.phase) * side * this.blend * 0.28;
      this.direction.set(0, -Math.cos(swing), Math.sin(swing)).transformDirection(this.root.matrixWorld);
      this.aim(joint, this.direction);
    }
  }
}
